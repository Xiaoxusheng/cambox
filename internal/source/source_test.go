package source

import (
	"testing"

	"camhub/internal/config"
)

func TestDecodeArgsUsesSubRTSP(t *testing.T) {
	cfg := config.CameraConfig{
		Type: config.TypeRTSP, RTSP: "rtsp://main/stream", SubRTSP: "rtsp://sub/stream",
		Width: 1280, Height: 720, FPS: 25,
	}
	args := decodeArgs(cfg)
	if !containsStr(args, "rtsp://sub/stream") || containsStr(args, "rtsp://main/stream") {
		t.Errorf("子码流非空时解码应用 sub_rtsp: %v", args)
	}
}

func TestDecodeArgsFallsBackToMainRTSP(t *testing.T) {
	cfg := config.CameraConfig{
		Type: config.TypeRTSP, RTSP: "rtsp://main/stream", SubRTSP: "",
		Width: 1280, Height: 720,
	}
	args := decodeArgs(cfg)
	if !containsStr(args, "rtsp://main/stream") {
		t.Errorf("子码流为空应回退主码流: %v", args)
	}
}

// 契约 §2.1: 解码统一加 -vf scale=W:H, 保证子码流分辨率与帧槽一致。
func TestDecodeArgsForcesScale(t *testing.T) {
	cases := []config.CameraConfig{
		{Type: config.TypeRTSP, RTSP: "rtsp://x", Width: 1280, Height: 720},
		{Type: config.TypeFile, File: "a.mp4", Width: 640, Height: 480},
		{Type: config.TypeDShow, DShowDevice: "cam", Width: 800, Height: 600},
		{Type: config.TypeSynthetic, Width: 1280, Height: 720, FPS: 25},
	}
	for _, cfg := range cases {
		args := decodeArgs(cfg)
		want := "scale=1280:720"
		if cfg.Width != 1280 {
			want = "scale=640:480"
			if cfg.Width == 800 {
				want = "scale=800:600"
			}
		}
		found := false
		for i, a := range args {
			if a == "-vf" && i+1 < len(args) && args[i+1] == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("type=%s 应包含 -vf %s: %v", cfg.Type, want, args)
		}
		if !containsStr(args, "bgr24") || !containsStr(args, "pipe:1") {
			t.Errorf("type=%s 输出格式错误: %v", cfg.Type, args)
		}
	}
}

func containsStr(args []string, s string) bool {
	for _, a := range args {
		if a == s {
			return true
		}
	}
	return false
}
