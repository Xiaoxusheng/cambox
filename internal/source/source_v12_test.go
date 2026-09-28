package source

import (
	"context"
	"strings"
	"testing"

	"camhub/internal/config"
)

// hasArg 按**完整元素**匹配。不能用 strings.Contains 判断 "-re":
// "-reset_timestamps" 这类参数也含 "-re" 子串, 会给出假阳性。
func hasArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

// v1.2: type=url 任意网络流。直播流**不能加 -re**(按原生帧率喂流会徒增延迟)。
func TestDecodeArgsURLNoRe(t *testing.T) {
	for _, u := range []string{
		"https://pull.example.com/live.flv",
		"http://pull.example.com/live.m3u8",
		"rtmp://push.example.com/live/stream",
	} {
		cfg := config.Default().Camera
		cfg.Type = config.TypeURL
		cfg.URL = u
		args := decodeArgs(cfg)
		if hasArg(args, "-re") {
			t.Errorf("直播流不能加 -re: %s → %v", u, args)
		}
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, "-i "+u) {
			t.Errorf("应使用 url 作为输入: %v", args)
		}
		if !hasArg(args, "-fflags") || !hasArg(args, "nobuffer") {
			t.Errorf("缺少低延迟参数: %v", args)
		}
	}
}

// reconnect 系列是 http 协议的 AVOption, 只有 http(s) 才该带; rtmp 传了会被 ffmpeg 告警。
func TestDecodeArgsReconnectOnlyForHTTP(t *testing.T) {
	cases := map[string]bool{
		"https://pull.example.com/live.flv":   true,
		"http://pull.example.com/live.flv":    true,
		"rtmp://push.example.com/live/stream": false,
		"rtsp://cam.local/stream0":            false,
	}
	for u, want := range cases {
		cfg := config.Default().Camera
		cfg.Type = config.TypeURL
		cfg.URL = u
		args := decodeArgs(cfg)
		got := hasArg(args, "-reconnect")
		if got != want {
			t.Errorf("url=%s: reconnect=%v, want %v (%v)", u, got, want, args)
		}
		if want && !(hasArg(args, "-reconnect_streamed") && hasArg(args, "-reconnect_delay_max")) {
			t.Errorf("http 应带完整的 reconnect 三件套: %v", args)
		}
	}
}

func TestDecodeArgsURLKeepsScaleAndFormat(t *testing.T) {
	cfg := config.Default().Camera
	cfg.Type = config.TypeURL
	cfg.URL = "https://x/live.flv"
	cfg.Width, cfg.Height = 854, 480
	args := decodeArgs(cfg)
	joined := strings.Join(args, " ")
	for _, want := range []string{"scale=854:480", "bgr24", "rawvideo", "pipe:1"} {
		if !strings.Contains(joined, want) {
			t.Errorf("缺少 %q: %v", want, args)
		}
	}
}

// type=url 但没填地址时, 必须给出明确错误而不是把空串喂给 ffmpeg
// (那样得到的是无法定位的 "Invalid argument")。
func TestRunOnceEmptyURLGivesClearError(t *testing.T) {
	cfg := config.Default().Camera
	cfg.Type = config.TypeURL
	cfg.URL = ""
	s := New(cfg)
	err := s.runOnce(context.Background(), s.frameSize())
	if err == nil {
		t.Fatal("空 url 应返回错误")
	}
	if !strings.Contains(err.Error(), "未配置流地址") {
		t.Errorf("错误信息应说明原因, got %q", err)
	}
}

// rtsp 仍优先子码流, 且不能被 v1.2 改动破坏。
func TestDecodeArgsRTSPStillPrefersSubStream(t *testing.T) {
	cfg := config.Default().Camera
	cfg.Type = config.TypeRTSP
	cfg.RTSP = "rtsp://cam/main"
	cfg.SubRTSP = "rtsp://cam/sub"
	joined := strings.Join(decodeArgs(cfg), " ")
	if !strings.Contains(joined, "-i rtsp://cam/sub") {
		t.Errorf("rtsp 应优先子码流: %s", joined)
	}
	if hasArg(decodeArgs(cfg), "-re") {
		t.Error("rtsp 解码不应加 -re")
	}
}
