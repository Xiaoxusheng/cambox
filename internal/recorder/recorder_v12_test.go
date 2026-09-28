package recorder

import (
	"strconv"
	"strings"
	"testing"

	"camhub/internal/config"
)

func hasArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

// 这层判定决定用户拿到的是原始码流还是二次压缩画质, 必须被单测钉死。
func TestRecordMode(t *testing.T) {
	cases := map[string]string{
		config.TypeRTSP:      ModeCopy,
		config.TypeURL:       ModeCopy, // v1.2 新增
		config.TypeSynthetic: ModeEncode,
		config.TypeFile:      ModeEncode,
		config.TypeDShow:     ModeEncode,
		"bogus":              ModeEncode,
	}
	for typ, want := range cases {
		cfg := *config.Default()
		cfg.Camera.Type = typ
		if got := recordMode(cfg); got != want {
			t.Errorf("type=%s: mode = %s, want %s", typ, got, want)
		}
	}
}

// url 源走 copy 时, 输入必须用 camera.url 且**不能**带 -rtsp_transport(RTSP 专用选项)。
func TestRecordArgsURLCopy(t *testing.T) {
	cfg := *config.Default()
	cfg.Camera.Type = config.TypeURL
	cfg.Camera.URL = "https://pull.example.com/live.flv"
	cfg.Camera.RTSP = "rtsp://should-not-be-used"
	args := recordArgs(cfg, ModeCopy)

	if hasArg(args, "-rtsp_transport") {
		t.Errorf("url 源不能用 -rtsp_transport: %v", args)
	}
	if !strings.Contains(strings.Join(args, " "), "-i "+cfg.Camera.URL) {
		t.Errorf("应使用 camera.url 作为输入: %v", args)
	}
	if strings.Contains(strings.Join(args, " "), "should-not-be-used") {
		t.Errorf("不应引用 camera.rtsp: %v", args)
	}
	if !hasArg(args, "-c") || !hasArg(args, "copy") {
		t.Errorf("url 源应走流复制: %v", args)
	}
	// http(s) 要带 reconnect, 长时间录制才扛得住断流
	if !hasArg(args, "-reconnect") {
		t.Errorf("http 地址录制应带 reconnect: %v", args)
	}
}

func TestRecordArgsURLRTMPNoReconnect(t *testing.T) {
	cfg := *config.Default()
	cfg.Camera.Type = config.TypeURL
	cfg.Camera.URL = "rtmp://push.example.com/live/stream"
	args := recordArgs(cfg, ModeCopy)
	if hasArg(args, "-reconnect") {
		t.Errorf("rtmp 不应带 reconnect(会被 ffmpeg 告警): %v", args)
	}
	if !hasArg(args, "copy") {
		t.Errorf("rtmp 仍应走 copy: %v", args)
	}
}

func TestRecordArgsRTSPUnchanged(t *testing.T) {
	cfg := *config.Default()
	cfg.Camera.Type = config.TypeRTSP
	cfg.Camera.RTSP = "rtsp://cam/main"
	args := recordArgs(cfg, ModeCopy)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-rtsp_transport tcp") || !strings.Contains(joined, "-i rtsp://cam/main") {
		t.Errorf("rtsp 的既有行为被破坏: %v", args)
	}
}

// v1.2: 编码模式的 CRF 必须来自 record.encode_crf, 而不是硬编码。
func TestRecordArgsCRFConfigurable(t *testing.T) {
	for _, crf := range []int{0, 18, 26, 51} {
		cfg := *config.Default()
		cfg.Camera.Type = config.TypeSynthetic
		cfg.Record.EncodeCRF = crf
		args := recordArgs(cfg, ModeEncode)
		want := "-crf " + strconv.Itoa(crf)
		if !strings.Contains(strings.Join(args, " "), want) {
			t.Errorf("crf=%d 应出现在参数里: %v", crf, args)
		}
	}
}
