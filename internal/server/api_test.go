package server

import (
	"encoding/json"
	"testing"

	"camhub/internal/config"
)

// 回归测试: API JSON 使用下划线风格字段, config 结构体必须带 json tag,
// 否则 min_area 等字段解码为 0 后被 Sanitize 钳到最小值(线上事故)。
// v1.1 起 GET/POST /api/config 使用 config.View(全量), 不再是精简的 configView。
func TestConfigViewJSONRoundTrip(t *testing.T) {
	body := `{
	  "camera": {"name": "前门", "type": "rtsp", "rtsp": "rtsp://m", "sub_rtsp": "rtsp://s"},
	  "motion": {"enabled": true, "threshold": 30, "min_area": 600, "cooldown_sec": 12,
	             "downscale_width": 320, "rois": [[0.1, 0.2, 0.3, 0.4]]},
	  "record": {"enabled": true, "segment_seconds": 300, "retention_days": 14, "max_disk_gb": 50},
	  "notify": {"cooldown_sec": 120, "telegram": {"enabled": true, "bot_token": "tk", "chat_id": "42"}},
	  "schedules": {"rules": [{"days": [1, 2], "start": "08:00", "end": "22:00", "motion": true, "record": false}]},
	  "selfcheck": {"enabled": true, "interval_sec": 120, "frozen_checks": 5, "change_threshold": 33, "change_checks": 2},
	  "digest": {"enabled": true, "time": "21:30"},
	  "bot": {"enabled": true, "bot_token": "bt", "allowed_users": ["111", "222"]}
	}`

	var view config.View
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	if view.Motion.MinArea != 600 || view.Motion.CooldownSec != 12 || view.Motion.DownscaleWidth != 320 {
		t.Errorf("motion 字段解码错误: %+v", view.Motion)
	}
	if len(view.Motion.ROIs) != 1 || view.Motion.ROIs[0].W != 0.3 {
		t.Errorf("rois 字段解码错误: %+v", view.Motion.ROIs)
	}
	if view.Record.SegmentSeconds != 300 || view.Record.RetentionDays != 14 || view.Record.MaxDiskGB != 50 {
		t.Errorf("record 字段解码错误: %+v", view.Record)
	}
	if view.Camera.SubRTSP != "rtsp://s" || view.Camera.Name != "前门" {
		t.Errorf("camera 字段解码错误: %+v", view.Camera)
	}
	if view.Notify.CooldownSec != 120 || view.Notify.Telegram.BotToken != "tk" {
		t.Errorf("notify 字段解码错误: %+v", view.Notify)
	}
	if len(view.Schedules.Rules) != 1 || view.SelfCheck.IntervalSec != 120 ||
		view.Digest.Time != "21:30" || len(view.Bot.AllowedUsers) != 2 {
		t.Errorf("v1.1 新增段解码错误: %+v", view)
	}

	// 序列化后字段必须是下划线风格, 且各段齐全
	out, err := json.Marshal(config.Default().View())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		`"min_area":`, `"cooldown_sec":`, `"segment_seconds":`, `"max_disk_gb":`,
		`"sub_rtsp":`, `"rois":`, `"notify":`, `"schedules":`, `"selfcheck":`,
		`"digest":`, `"bot":`, `"allowed_users":`, `"change_threshold":`,
	} {
		if !jsonKeyPresent(out, key) {
			t.Errorf("JSON 输出缺少 %s: %s", key, out)
		}
	}
}

func jsonKeyPresent(data []byte, key string) bool {
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
