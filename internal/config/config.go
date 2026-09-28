// Package config 负责配置的加载、保存、默认值与合法性钳制。
// 设计见 docs/开发文档.md §4.1。
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// CameraType 取流来源类型（camera.type 合法值）。
const (
	TypeSynthetic = "synthetic"
	TypeRTSP      = "rtsp"
	TypeFile      = "file"
	TypeDShow     = "dshow"
)

type Config struct {
	Camera CameraConfig `yaml:"camera"`
	Record RecordConfig `yaml:"record"`
	Motion MotionConfig `yaml:"motion"`
	Server ServerConfig `yaml:"server"`
}

type CameraConfig struct {
	Name           string `yaml:"name" json:"name"`
	Type           string `yaml:"type" json:"type"` // synthetic | rtsp | file | dshow
	RTSP           string `yaml:"rtsp" json:"rtsp"`
	File           string `yaml:"file" json:"file"`
	DShowDevice    string `yaml:"dshow_device" json:"dshow_device"`
	Width          int    `yaml:"width" json:"width"`
	Height         int    `yaml:"height" json:"height"`
	FPS            int    `yaml:"fps" json:"fps"`
	ReconnectDelay int    `yaml:"reconnect_delay_sec" json:"reconnect_delay_sec"`
}

type RecordConfig struct {
	Enabled        bool    `yaml:"enabled" json:"enabled"`
	Dir            string  `yaml:"dir" json:"dir"`
	SegmentSeconds int     `yaml:"segment_seconds" json:"segment_seconds"`
	RetentionDays  int     `yaml:"retention_days" json:"retention_days"`
	MaxDiskGB      float64 `yaml:"max_disk_gb" json:"max_disk_gb"`
}

type MotionConfig struct {
	Enabled        bool `yaml:"enabled" json:"enabled"`
	Threshold      int  `yaml:"threshold" json:"threshold"` // 像素差阈值, 越小越灵敏
	MinArea        int  `yaml:"min_area" json:"min_area"`   // 降采样图上触发像素数
	CooldownSec    int  `yaml:"cooldown_sec" json:"cooldown_sec"`
	DownscaleWidth int  `yaml:"downscale_width" json:"downscale_width"`
}

type ServerConfig struct {
	Host        string `yaml:"host" json:"host"`
	Port        int    `yaml:"port" json:"port"`
	DataDir     string `yaml:"data_dir" json:"data_dir"`
	SnapshotDir string `yaml:"snapshot_dir" json:"snapshot_dir"`
}

// Default 返回文档规定的默认配置。
func Default() *Config {
	return &Config{
		Camera: CameraConfig{
			Name:           "模拟摄像头",
			Type:           TypeSynthetic,
			Width:          1280,
			Height:         720,
			FPS:            25,
			ReconnectDelay: 3,
		},
		Record: RecordConfig{
			Enabled:        true,
			Dir:            "recordings",
			SegmentSeconds: 600,
			RetentionDays:  7,
			MaxDiskGB:      20,
		},
		Motion: MotionConfig{
			Enabled:        true,
			Threshold:      22,
			MinArea:        500,
			CooldownSec:    8,
			DownscaleWidth: 320,
		},
		Server: ServerConfig{
			Host:        "127.0.0.1",
			Port:        8787,
			DataDir:     "data",
			SnapshotDir: "snapshots",
		},
	}
}

// Load 读取 YAML 配置; 文件不存在时生成默认配置文件。
func Load(path string) (*Config, error) {
	c := Default()
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("读取配置: %w", err)
		}
		if err := Save(path, c); err != nil {
			return nil, fmt.Errorf("生成默认配置: %w", err)
		}
		return c, nil
	}
	if err := yaml.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("解析配置 %s: %w", path, err)
	}
	c.Sanitize()
	return c, nil
}

// Save 原子写配置(临时文件 + rename), 写入前先钳制。
func Save(path string, c *Config) error {
	c.Sanitize()
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("序列化配置: %w", err)
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Sanitize 将非法值钳制到开发文档 §4.1 规定的范围。
func (c *Config) Sanitize() {
	switch c.Camera.Type {
	case TypeSynthetic, TypeRTSP, TypeFile, TypeDShow:
	default:
		c.Camera.Type = TypeSynthetic
	}
	if c.Camera.Name == "" {
		c.Camera.Name = "摄像头"
	}
	c.Camera.Width = clampInt(c.Camera.Width, 320, 3840)
	c.Camera.Height = clampInt(c.Camera.Height, 240, 2160)
	c.Camera.FPS = clampInt(c.Camera.FPS, 1, 60)
	c.Camera.ReconnectDelay = clampInt(c.Camera.ReconnectDelay, 1, 300)

	if c.Record.Dir == "" {
		c.Record.Dir = "recordings"
	}
	c.Record.SegmentSeconds = clampInt(c.Record.SegmentSeconds, 10, 86400)
	c.Record.RetentionDays = clampInt(c.Record.RetentionDays, 1, 365)
	c.Record.MaxDiskGB = clampFloat(c.Record.MaxDiskGB, 0.1, 10000)

	c.Motion.Threshold = clampInt(c.Motion.Threshold, 1, 255)
	c.Motion.MinArea = clampInt(c.Motion.MinArea, 1, 1000000)
	c.Motion.CooldownSec = clampInt(c.Motion.CooldownSec, 1, 3600)
	c.Motion.DownscaleWidth = clampInt(c.Motion.DownscaleWidth, 64, 1280)

	if c.Server.Host == "" {
		c.Server.Host = "127.0.0.1"
	}
	c.Server.Port = clampInt(c.Server.Port, 1, 65535)
	if c.Server.DataDir == "" {
		c.Server.DataDir = "data"
	}
	if c.Server.SnapshotDir == "" {
		c.Server.SnapshotDir = "snapshots"
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
