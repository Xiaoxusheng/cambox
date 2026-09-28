package server

import (
	"encoding/json"
	"testing"

	"camhub/internal/config"
)

// 回归测试: API JSON 使用下划线风格字段, config 结构体必须带 json tag,
// 否则 min_area 等字段解码为 0 后被 Sanitize 钳到最小值(线上事故)。
func TestConfigViewJSONRoundTrip(t *testing.T) {
	body := `{
	  "motion": {"enabled": true, "threshold": 30, "min_area": 600, "cooldown_sec": 12, "downscale_width": 320},
	  "record": {"enabled": true, "segment_seconds": 300, "retention_days": 14, "max_disk_gb": 50}
	}`

	var view configView
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	if view.Motion.MinArea != 600 || view.Motion.CooldownSec != 12 || view.Motion.DownscaleWidth != 320 {
		t.Errorf("motion 字段解码错误: %+v", view.Motion)
	}
	if view.Record.SegmentSeconds != 300 || view.Record.RetentionDays != 14 || view.Record.MaxDiskGB != 50 {
		t.Errorf("record 字段解码错误: %+v", view.Record)
	}

	// 序列化后字段必须是下划线风格
	out, err := json.Marshal(configView{Motion: config.Default().Motion, Record: config.Default().Record})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"min_area":`, `"cooldown_sec":`, `"segment_seconds":`, `"max_disk_gb":`} {
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
