package server

import (
	"strings"
	"testing"
	"time"

	"camhub/internal/config"
)

// previewInterval 由 camera.preview_fps 换算; <=0 的兜底为防御性(正常路径 Sanitize 已钳到 1~30)。
func TestPreviewInterval(t *testing.T) {
	cases := []struct {
		fps  int
		want time.Duration
	}{
		{30, time.Second / 30},
		{15, time.Second / 15},
		{1, time.Second},
		{0, time.Second / config.DefaultPreviewFPS},  // 防御性兜底 → 默认
		{-5, time.Second / config.DefaultPreviewFPS}, // 防御性兜底 → 默认
		{999, time.Second / 30},                      // 超上限 → 30
	}
	for _, tc := range cases {
		c := *config.Default()
		c.Camera.PreviewFPS = tc.fps
		if got := previewInterval(c); got != tc.want {
			t.Errorf("fps=%d: interval = %v, want %v", tc.fps, got, tc.want)
		}
	}
}

// 契约 §3.1: config 的 camera 段含 url / preview_quality / preview_fps, record 段含 encode_crf。
func TestV12ConfigFieldsExposed(t *testing.T) {
	h := newHarness(t)
	_, resp := h.do(t, "GET", "/api/config", "")
	data := string(resp.Data)
	for _, key := range []string{
		`"url"`, `"preview_quality"`, `"preview_fps"`, `"encode_crf"`,
	} {
		if !strings.Contains(data, key) {
			t.Errorf("GET /api/config 缺少 %s", key)
		}
	}
}

// POST 时新字段要落盘 + 运行时生效 + 越界被钳制。
func TestV12ConfigRoundTripAndClamp(t *testing.T) {
	h := newHarness(t)
	body := `{"camera":{"type":"url","url":"https://example.com/live.flv",
	          "preview_quality":101,"preview_fps":31},
	         "record":{"encode_crf":52}}`
	code, resp := h.do(t, "POST", "/api/config", body)
	if code != 200 {
		t.Fatalf("应 200, got %d (%s)", code, resp.Message)
	}
	out := decodeData[config.View](t, resp)
	if out.Camera.Type != config.TypeURL || out.Camera.URL != "https://example.com/live.flv" {
		t.Errorf("url 类型/地址未生效: %+v", out.Camera)
	}
	if out.Camera.PreviewQuality != 100 || out.Camera.PreviewFPS != 30 {
		t.Errorf("画质字段未钳制: q=%d fps=%d", out.Camera.PreviewQuality, out.Camera.PreviewFPS)
	}
	if out.Record.EncodeCRF != 51 {
		t.Errorf("crf 未钳制: %d", out.Record.EncodeCRF)
	}
	// 运行时热更新
	if cfg := h.pl.Settings(); cfg.Camera.PreviewQuality != 100 || cfg.Camera.PreviewFPS != 30 {
		t.Errorf("热更新未下发: q=%d fps=%d", cfg.Camera.PreviewQuality, cfg.Camera.PreviewFPS)
	}
	// 已落盘
	reloaded, err := config.Load(h.cfgAt)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Camera.URL != "https://example.com/live.flv" || reloaded.Record.EncodeCRF != 51 {
		t.Errorf("未持久化: url=%q crf=%d", reloaded.Camera.URL, reloaded.Record.EncodeCRF)
	}
}
