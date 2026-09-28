package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSanitizeClamps(t *testing.T) {
	c := Default()
	c.Camera.Type = "bogus"
	c.Camera.FPS = 100
	c.Camera.Width = 1
	c.Server.Port = -1
	c.Record.MaxDiskGB = 0
	c.Motion.Threshold = 0
	c.Motion.CooldownSec = 99999
	c.Camera.Name = ""
	c.Record.Dir = ""
	c.Server.Host = ""

	c.Sanitize()

	if c.Camera.Type != TypeSynthetic {
		t.Errorf("非法类型应回退 synthetic, got %q", c.Camera.Type)
	}
	if c.Camera.FPS != 60 {
		t.Errorf("FPS 应钳到 60, got %d", c.Camera.FPS)
	}
	if c.Camera.Width != 320 {
		t.Errorf("Width 应钳到 320, got %d", c.Camera.Width)
	}
	if c.Server.Port != 1 {
		t.Errorf("Port 应钳到 1, got %d", c.Server.Port)
	}
	if c.Record.MaxDiskGB != 0.1 {
		t.Errorf("MaxDiskGB 应钳到 0.1, got %v", c.Record.MaxDiskGB)
	}
	if c.Motion.Threshold != 1 {
		t.Errorf("Threshold 应钳到 1, got %d", c.Motion.Threshold)
	}
	if c.Motion.CooldownSec != 3600 {
		t.Errorf("CooldownSec 应钳到 3600, got %d", c.Motion.CooldownSec)
	}
	if c.Camera.Name == "" || c.Record.Dir == "" || c.Server.Host == "" {
		t.Error("空字符串字段应回填默认值")
	}
}

func TestLoadSaveRoundtrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")

	c1, err := Load(path) // 文件不存在 → 生成默认
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("默认配置文件未生成: %v", err)
	}

	c1.Camera.Name = "前门"
	c1.Motion.MinArea = 800
	c1.Record.Enabled = false
	if err := Save(path, c1); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Error("原子写后不应残留 .tmp 文件")
	}

	c2, err := Load(path)
	if err != nil {
		t.Fatalf("重新 Load: %v", err)
	}
	if c2.Camera.Name != "前门" || c2.Motion.MinArea != 800 || c2.Record.Enabled {
		t.Errorf("roundtrip 数据不一致: %+v", c2)
	}
}

func TestLoadInvalidYAML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("camera: [broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Error("非法 YAML 应返回错误")
	}
}

// ---- v1.1 ----

// 回归: 所有字段必须有 json tag, 下划线风格字段经 JSON 往返不能丢。
func TestV11JSONTags(t *testing.T) {
	data, err := json.Marshal(Default())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		`"sub_rtsp":`, `"rois":`, `"cooldown_sec":`, `"dingtalk":`, `"wecom":`,
		`"telegram":`, `"bark":`, `"webhook":`, `"bot_token":`, `"chat_id":`,
		`"device_key":`, `"schedules":`, `"selfcheck":`, `"frozen_checks":`,
		`"change_threshold":`, `"digest":`, `"allowed_users":`,
	} {
		if !jsonHasKey(data, key) {
			t.Errorf("JSON 输出缺少 %s: %s", key, data)
		}
	}

	// 反序列化带下划线字段的 JSON 后数值不丢
	body := `{"camera":{"sub_rtsp":"rtsp://s"},"motion":{"min_area":777,"rois":[[0.1,0.2,0.3,0.4]]},
	  "notify":{"cooldown_sec":120,"telegram":{"bot_token":"tk","chat_id":"42"}},
	  "schedules":{"rules":[{"days":[1,2],"start":"08:00","end":"22:00","motion":true,"record":false}]},
	  "selfcheck":{"interval_sec":120,"frozen_checks":5,"change_threshold":33,"change_checks":2},
	  "digest":{"time":"21:30"},"bot":{"allowed_users":["111","222"]}}`
	var c Config
	if err := json.Unmarshal([]byte(body), &c); err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	if c.Camera.SubRTSP != "rtsp://s" || c.Motion.MinArea != 777 || len(c.Motion.ROIs) != 1 ||
		c.Notify.CooldownSec != 120 || c.Notify.Telegram.BotToken != "tk" ||
		len(c.Schedules.Rules) != 1 || c.SelfCheck.IntervalSec != 120 ||
		c.Digest.Time != "21:30" || len(c.Bot.AllowedUsers) != 2 {
		t.Errorf("v1.1 字段解码错误: %+v", c)
	}
}

func jsonHasKey(data []byte, key string) bool {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return false
	}
	return containsJSONKey(m, key)
}

func containsJSONKey(m map[string]any, key string) bool {
	for k, v := range m {
		if `"`+k+`":` == key {
			return true
		}
		if sub, ok := v.(map[string]any); ok && containsJSONKey(sub, key) {
			return true
		}
	}
	return false
}

func TestSanitizeV11(t *testing.T) {
	c := Default()
	c.Notify.CooldownSec = 5 // 低于下限
	c.Notify.Bark.Server = ""
	c.Motion.ROIs = []ROI{
		{X: -0.2, Y: 0.1, W: 5, H: 0.3},  // 钳到 [0,1], w 裁到 1-x
		{X: 0.5, Y: 0.5, W: 0, H: 0.5},   // w=0 → 丢弃
		{X: 0.9, Y: 0.9, W: 0.5, H: 0.5}, // 越界裁剪 → w=h=0.1
	}
	c.Schedules.Rules = []ScheduleRule{
		{Days: []int{1, 9}, Start: "8:00", End: "22:00", Motion: true},     // 天数 9 无效 → 丢弃整条
		{Days: []int{3}, Start: "25:00", End: "22:00", Motion: true},       // 时间非法 → 丢弃
		{Days: []int{1, 2, 3}, Start: "08:30", End: "23:05", Record: true}, // 合法, 归一化
	}
	c.SelfCheck.IntervalSec = 10
	c.SelfCheck.FrozenChecks = 0
	c.SelfCheck.ChangeChecks = 100
	c.SelfCheck.ChangeThreshold = 300
	c.Digest.Time = "bogus"
	c.Bot.AllowedUsers = []string{"123", "abc", "", " 456 "}

	c.Sanitize()

	if c.Notify.CooldownSec != 10 {
		t.Errorf("notify.cooldown_sec 应钳到 10, got %d", c.Notify.CooldownSec)
	}
	if c.Notify.Bark.Server != DefaultBarkServer {
		t.Errorf("bark.server 空应回填默认, got %q", c.Notify.Bark.Server)
	}
	if len(c.Motion.ROIs) != 2 {
		t.Fatalf("ROIs 应保留 2 个, got %d: %+v", len(c.Motion.ROIs), c.Motion.ROIs)
	}
	if c.Motion.ROIs[0] != (ROI{X: 0, Y: 0.1, W: 1, H: 0.3}) {
		t.Errorf("ROI[0] 钳制错误: %+v", c.Motion.ROIs[0])
	}
	if c.Motion.ROIs[1] != (ROI{X: 0.9, Y: 0.9, W: 0.1, H: 0.1}) {
		t.Errorf("ROI[1] 钳制错误: %+v", c.Motion.ROIs[1])
	}
	// 规则1: 天数 9 被过滤后剩 [1], 保留; 规则2 时间非法整条丢弃; 规则3 合法保留
	if len(c.Schedules.Rules) != 2 ||
		c.Schedules.Rules[0].Start != "08:00" || c.Schedules.Rules[0].End != "22:00" ||
		len(c.Schedules.Rules[0].Days) != 1 || c.Schedules.Rules[0].Days[0] != 1 {
		t.Errorf("日程规则钳制错误: %+v", c.Schedules.Rules)
	}
	if c.SelfCheck.IntervalSec != 60 || c.SelfCheck.FrozenChecks != 1 ||
		c.SelfCheck.ChangeChecks != 60 || c.SelfCheck.ChangeThreshold != 255 {
		t.Errorf("selfcheck 钳制错误: %+v", c.SelfCheck)
	}
	if c.Digest.Time != DefaultDigestTime {
		t.Errorf("digest.time 非法应回填默认, got %q", c.Digest.Time)
	}
	if len(c.Bot.AllowedUsers) != 2 || c.Bot.AllowedUsers[0] != "123" || c.Bot.AllowedUsers[1] != "456" {
		t.Errorf("allowed_users 应只保留非空数字: %+v", c.Bot.AllowedUsers)
	}

	// nil 切片 → 空切片(JSON [])
	c2 := Default()
	c2.Motion.ROIs = nil
	c2.Bot.AllowedUsers = nil
	c2.Sanitize()
	if c2.Motion.ROIs == nil || c2.Bot.AllowedUsers == nil {
		t.Error("nil 切片应回填为空切片")
	}
}

func TestSanitizeROIsMax8(t *testing.T) {
	c := Default()
	for i := 0; i < 12; i++ {
		c.Motion.ROIs = append(c.Motion.ROIs, ROI{X: 0, Y: 0, W: 0.1, H: 0.1})
	}
	c.Sanitize()
	if len(c.Motion.ROIs) != MaxROIs {
		t.Errorf("ROIs 应最多保留 %d 个, got %d", MaxROIs, len(c.Motion.ROIs))
	}
}

func TestScheduleActiveAt(t *testing.T) {
	// 2026-09-28 是周一(weekdayNum=1)
	mon := time.Date(2026, 9, 28, 0, 0, 0, 0, time.Local)

	// 空 = 全天放行
	s := SchedulesConfig{}
	if m, r := s.ActiveAt(mon); !m || !r {
		t.Errorf("空规则应全天放行, got motion=%v record=%v", m, r)
	}

	s = SchedulesConfig{Rules: []ScheduleRule{
		{Days: []int{1, 2, 3, 4, 5}, Start: "08:00", End: "22:00", Motion: true, Record: false},
	}}
	cases := []struct {
		h, min         int
		motion, record bool
	}{
		{7, 59, false, false},
		{8, 0, true, false}, // 闭区间
		{12, 0, true, false},
		{21, 59, true, false},
		{22, 0, false, false}, // end 开区间
	}
	for _, tc := range cases {
		m, r := s.ActiveAt(mon.Add(time.Duration(tc.h)*time.Hour + time.Duration(tc.min)*time.Minute))
		if m != tc.motion || r != tc.record {
			t.Errorf("%02d:%02d → motion=%v record=%v, want %v/%v", tc.h, tc.min, m, r, tc.motion, tc.record)
		}
	}

	// 周末不放行
	sat := mon.AddDate(0, 0, 5)
	if m, _ := s.ActiveAt(sat.Add(10 * time.Hour)); m {
		t.Error("周六不应放行")
	}

	// start==end 视为全天
	allDay := SchedulesConfig{Rules: []ScheduleRule{{Days: []int{1}, Start: "00:00", End: "00:00", Motion: true, Record: true}}}
	if m, r := allDay.ActiveAt(mon.Add(3 * time.Hour)); !m || !r {
		t.Errorf("start==end 应视为全天, got %v/%v", m, r)
	}

	// 跨零点: 周一 22:00 → 周二 06:00
	cross := SchedulesConfig{Rules: []ScheduleRule{{Days: []int{1}, Start: "22:00", End: "06:00", Motion: true, Record: true}}}
	if m, _ := cross.ActiveAt(mon.Add(23 * time.Hour)); !m {
		t.Error("周一 23:00 应命中跨零点规则")
	}
	if m, _ := cross.ActiveAt(mon.Add(25 * time.Hour)); !m { // 周二 01:00
		t.Error("周二 01:00 应命中跨零点规则(前一日窗口)")
	}
	if m, _ := cross.ActiveAt(mon.Add(7 * time.Hour)); m {
		t.Error("周一 07:00 不应命中")
	}

	// 多规则 OR 合并
	multi := SchedulesConfig{Rules: []ScheduleRule{
		{Days: []int{1}, Start: "08:00", End: "12:00", Motion: true, Record: false},
		{Days: []int{1}, Start: "10:00", End: "18:00", Motion: false, Record: true},
	}}
	m, r := multi.ActiveAt(mon.Add(9 * time.Hour)) // 09:00
	if !m || r {
		t.Errorf("09:00 应只放行 motion, got %v/%v", m, r)
	}
	m, r = multi.ActiveAt(mon.Add(11 * time.Hour)) // 11:00 重叠段
	if !m || !r {
		t.Errorf("11:00 应 OR 放行两者, got %v/%v", m, r)
	}
	m, r = multi.ActiveAt(mon.Add(15 * time.Hour)) // 15:00
	if m || !r {
		t.Errorf("15:00 应只放行 record, got %v/%v", m, r)
	}
}

// ROI 线上形态必须是 [x,y,w,h] 四元数组（契约 §1 / §3.2，前端 Roi 类型同构）。
// 回归背景：后端一度用 {x,y,w,h} 对象、前端用数组，两边各自"对齐契约"却静默分叉，
// 前端保存 ROI 到真实后端直接 400。
func TestROIWireFormatIsFourElementArray(t *testing.T) {
	var v View
	if err := json.Unmarshal([]byte(`{"motion":{"rois":[[0.1,0.2,0.3,0.4]]}}`), &v); err != nil {
		t.Fatalf("数组形态应可解码: %v", err)
	}
	if len(v.Motion.ROIs) != 1 {
		t.Fatalf("应解出 1 个 roi, 实际 %d", len(v.Motion.ROIs))
	}
	r := v.Motion.ROIs[0]
	if r.X != 0.1 || r.Y != 0.2 || r.W != 0.3 || r.H != 0.4 {
		t.Errorf("roi 分量解码错误: %+v", r)
	}

	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"rois":[[0.1,0.2,0.3,0.4]]`) {
		t.Errorf("roi 必须编码为四元数组, 实际 %s", out)
	}

	// 旧的对象形态必须被拒绝(不能静默解成零值)
	if err := json.Unmarshal([]byte(`{"motion":{"rois":[{"x":0.1,"y":0.2,"w":0.3,"h":0.4}]}}`), &v); err == nil {
		t.Error("对象形态应报错, 否则会静默解成 0 值被 Sanitize 丢掉")
	}
	// 元素个数不对也必须报错
	if err := json.Unmarshal([]byte(`{"motion":{"rois":[[0.1,0.2]]}}`), &v); err == nil {
		t.Error("非四元数组应报错")
	}
}

// YAML 形态同样必须是四元数组(配置文件可读可写)。
func TestROIRoundTripYAML(t *testing.T) {
	c := Default()
	c.Motion.ROIs = []ROI{{X: 0.1, Y: 0.2, W: 0.3, H: 0.4}}
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := Save(path, c); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Motion.ROIs) != 1 {
		t.Fatalf("YAML 往返后 roi 数量错误: %+v", got.Motion.ROIs)
	}
	r := got.Motion.ROIs[0]
	if r.X != 0.1 || r.Y != 0.2 || r.W != 0.3 || r.H != 0.4 {
		t.Errorf("YAML 往返后 roi 分量错误: %+v", r)
	}
}
