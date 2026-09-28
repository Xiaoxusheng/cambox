package config

import (
	"strings"
	"testing"
)

// v1.2: 新增 camera.url / camera.preview_quality / camera.preview_fps / record.encode_crf。
// 默认值必须与 v1.1 的硬编码值一致(80 / 15 / 26), 否则老用户升级后画质行为会突变。
func TestV12DefaultsMatchV11Behavior(t *testing.T) {
	c := Default()
	if c.Camera.PreviewQuality != 80 || c.Camera.PreviewFPS != 15 || c.Record.EncodeCRF != 26 {
		t.Fatalf("默认值应与 v1.1 一致: quality=%d fps=%d crf=%d",
			c.Camera.PreviewQuality, c.Camera.PreviewFPS, c.Record.EncodeCRF)
	}
	if c.Camera.URL != "" {
		t.Errorf("默认 url 应为空, got %q", c.Camera.URL)
	}
}

func TestV12Clamps(t *testing.T) {
	cases := []struct {
		name            string
		mutate          func(*Config)
		wantQuality     int
		wantFPS         int
		wantCRF         int
		wantDefaultHint string
	}{
		{"未填(0)回到默认", func(c *Config) {
			c.Camera.PreviewQuality, c.Camera.PreviewFPS, c.Record.EncodeCRF = 0, 0, 0
		}, 80, 15, 0, "crf=0 是合法的无损值, 不能被当成未填"},
		{"上限", func(c *Config) {
			c.Camera.PreviewQuality, c.Camera.PreviewFPS, c.Record.EncodeCRF = 101, 31, 52
		}, 100, 30, 51, ""},
		{"负数为未填", func(c *Config) {
			c.Camera.PreviewQuality, c.Camera.PreviewFPS, c.Record.EncodeCRF = -1, -1, -1
		}, 80, 15, 26, ""},
		{"中间值保留", func(c *Config) {
			c.Camera.PreviewQuality, c.Camera.PreviewFPS, c.Record.EncodeCRF = 50, 24, 18
		}, 50, 24, 18, ""},
	}
	for _, tc := range cases {
		c := Default()
		tc.mutate(c)
		c.Sanitize()
		if c.Camera.PreviewQuality != tc.wantQuality {
			t.Errorf("%s: quality = %d, want %d", tc.name, c.Camera.PreviewQuality, tc.wantQuality)
		}
		if c.Camera.PreviewFPS != tc.wantFPS {
			t.Errorf("%s: fps = %d, want %d", tc.name, c.Camera.PreviewFPS, tc.wantFPS)
		}
		if c.Record.EncodeCRF != tc.wantCRF {
			t.Errorf("%s: crf = %d, want %d (%s)", tc.name, c.Record.EncodeCRF, tc.wantCRF, tc.wantDefaultHint)
		}
	}
}

// type=url 必须被 Sanitize 保留(否则老校验逻辑会把新类型退化成 synthetic)。
func TestV12URLTypeAccepted(t *testing.T) {
	c := Default()
	c.Camera.Type = TypeURL
	c.Camera.URL = "https://example.com/live.flv"
	c.Sanitize()
	if c.Camera.Type != TypeURL {
		t.Fatalf("type=url 应被保留, got %q", c.Camera.Type)
	}
	if strings.TrimSpace(c.Camera.URL) != c.Camera.URL {
		t.Error("url 应被 trim")
	}

	c2 := Default()
	c2.Camera.Type = "bogus"
	c2.Sanitize()
	if c2.Camera.Type != TypeSynthetic {
		t.Errorf("非法 type 仍应回退 synthetic, got %q", c2.Camera.Type)
	}
}

// 配置文件往返: 新字段不能丢。
func TestV12RoundTripYAML(t *testing.T) {
	c := Default()
	c.Camera.Type = TypeURL
	c.Camera.URL = "https://example.com/live/stream.m3u8"
	c.Camera.PreviewQuality = 65
	c.Camera.PreviewFPS = 10
	c.Record.EncodeCRF = 18

	path := t.TempDir() + "/config.yaml"
	if err := Save(path, c); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Camera.URL != c.Camera.URL || got.Camera.Type != TypeURL {
		t.Errorf("url/type 往返丢失: %+v", got.Camera)
	}
	if got.Camera.PreviewQuality != 65 || got.Camera.PreviewFPS != 10 || got.Record.EncodeCRF != 18 {
		t.Errorf("画质字段往返丢失: q=%d fps=%d crf=%d",
			got.Camera.PreviewQuality, got.Camera.PreviewFPS, got.Record.EncodeCRF)
	}
}
