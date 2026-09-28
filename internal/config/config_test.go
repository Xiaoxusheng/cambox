package config

import (
	"os"
	"path/filepath"
	"testing"
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
