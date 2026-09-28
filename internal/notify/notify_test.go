package notify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"camhub/internal/config"
)

// recorder 记录收到的请求, 供断言。
type recorder struct {
	mu    sync.Mutex
	reqs  []recordedReq
	fail  bool
	reply string
	code  int
}

type recordedReq struct {
	path   string
	query  string
	header http.Header
	body   []byte
}

func (r *recorder) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		r.mu.Lock()
		r.reqs = append(r.reqs, recordedReq{path: req.URL.Path, query: req.URL.RawQuery, header: req.Header.Clone(), body: body})
		fail := r.fail
		reply := r.reply
		code := r.code
		r.mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("boom"))
			return
		}
		if code != 0 {
			w.WriteHeader(code)
		}
		if reply != "" {
			_, _ = w.Write([]byte(reply))
		}
	}
}

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.reqs)
}

func (r *recorder) last() recordedReq {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reqs[len(r.reqs)-1]
}

func TestEnabledChannelsRequiresCompleteConfig(t *testing.T) {
	n := New(config.NotifyConfig{})
	if got := n.EnabledChannels(n.Config()); len(got) != 0 {
		t.Errorf("空配置不应有启用通道, got %v", got)
	}

	cfg := config.NotifyConfig{
		DingTalk: config.DingTalkConfig{Enabled: true},                               // 缺 webhook
		Wecom:    config.WecomConfig{Enabled: true, Webhook: "https://x"},            // 完整
		Telegram: config.TelegramConfig{Enabled: true, BotToken: "tk"},               // 缺 chat_id
		Bark:     config.BarkConfig{Enabled: false, DeviceKey: "k"},                  // 未启用
		Webhook:  config.WebhookConfig{Enabled: true, URL: "https://y", Secret: "s"}, // 完整
	}
	got := n.EnabledChannels(cfg)
	want := []string{ChannelWecom, ChannelWebhook}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("启用通道 = %v, want %v", got, want)
	}
}

func TestWebhookPayloadAndSignature(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{Webhook: config.WebhookConfig{Enabled: true, URL: ts.URL, Secret: "s3cr3t"}})
	res := n.SendChannel(context.Background(), "", Message{Title: "移动侦测", Body: "得分 900", ImageURL: "/media/x.jpg"})
	if len(res) != 1 || !res[0].OK {
		t.Fatalf("推送应成功: %+v", res)
	}
	if res[0].Channel != ChannelWebhook {
		t.Errorf("channel = %q", res[0].Channel)
	}

	got := rec.last()
	var payload map[string]any
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("请求体不是 JSON: %v (%s)", err, got.body)
	}
	if payload["title"] != "移动侦测" || payload["body"] != "得分 900" || payload["image_url"] != "/media/x.jpg" {
		t.Errorf("payload 字段不符: %v", payload)
	}
	if _, ok := payload["time"]; !ok {
		t.Error("payload 应带 time")
	}

	// 签名: X-Camhub-Signature = sha256=hex(HMAC-SHA256(body, secret))
	mac := hmac.New(sha256.New, []byte("s3cr3t"))
	mac.Write(got.body)
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if got.header.Get("X-Camhub-Signature") != want {
		t.Errorf("签名不符: got %q want %q", got.header.Get("X-Camhub-Signature"), want)
	}
}

func TestWebhookNoSecretNoSignatureHeader(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{Webhook: config.WebhookConfig{Enabled: true, URL: ts.URL}})
	if res := n.SendChannel(context.Background(), ChannelWebhook, Message{Title: "t"}); !res[0].OK {
		t.Fatalf("推送应成功: %+v", res)
	}
	if rec.last().header.Get("X-Camhub-Signature") != "" {
		t.Error("未配置 secret 时不应带签名头")
	}
}

func TestDingTalkSignAndMarkdown(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{DingTalk: config.DingTalkConfig{Enabled: true, Webhook: ts.URL + "/robot/send", Secret: "SEC"}})
	n.now = func() time.Time { return time.Unix(1790000000, 0) }

	res := n.SendChannel(context.Background(), ChannelDingTalk, Message{Title: "标题", Body: "正文"})
	if !res[0].OK {
		t.Fatalf("钉钉推送应成功: %+v", res)
	}
	got := rec.last()
	q, err := url.ParseQuery(got.query)
	if err != nil {
		t.Fatalf("query 解析失败: %v", err)
	}
	if q.Get("timestamp") != "1790000000000" {
		t.Errorf("timestamp = %q", q.Get("timestamp"))
	}
	if q.Get("sign") != DingTalkSign("1790000000000", "SEC") {
		t.Errorf("sign 与 DingTalkSign 不一致: %q", q.Get("sign"))
	}

	var payload map[string]any
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["msgtype"] != "markdown" {
		t.Errorf("msgtype = %v", payload["msgtype"])
	}
	md := payload["markdown"].(map[string]any)
	if md["title"] != "标题" || !strings.Contains(md["text"].(string), "正文") {
		t.Errorf("markdown 内容不符: %v", md)
	}
}

func TestDingTalkBusinessErrorDetected(t *testing.T) {
	rec := &recorder{reply: `{"errcode":310000,"errmsg":"sign not match"}`}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{DingTalk: config.DingTalkConfig{Enabled: true, Webhook: ts.URL}})
	res := n.SendChannel(context.Background(), ChannelDingTalk, Message{Title: "t"})
	if len(res) != 1 || res[0].OK {
		t.Fatalf("errcode!=0 应判为失败: %+v", res)
	}
	if !strings.Contains(res[0].Error, "310000") {
		t.Errorf("错误信息应含 errcode, got %q", res[0].Error)
	}
}

func TestHTTPErrorReported(t *testing.T) {
	rec := &recorder{fail: true}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{Wecom: config.WecomConfig{Enabled: true, Webhook: ts.URL}})
	res := n.SendChannel(context.Background(), ChannelWecom, Message{Title: "t"})
	if len(res) != 1 || res[0].OK {
		t.Fatalf("HTTP 500 应判为失败: %+v", res)
	}
	if !strings.Contains(res[0].Error, "500") {
		t.Errorf("错误信息应含状态码, got %q", res[0].Error)
	}
}

// 契约 §1: 同一通道最小推送间隔 notify.cooldown_sec。
func TestCooldownLimitsPerChannel(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{
		CooldownSec: 60,
		Webhook:     config.WebhookConfig{Enabled: true, URL: ts.URL},
		Wecom:       config.WecomConfig{Enabled: true, Webhook: ts.URL + "/wecom"},
	})
	ctx := context.Background()

	// 第一次: 两个通道各推一次
	if res := n.dispatch(ctx, n.Config(), n.EnabledChannels(n.Config()), Message{Title: "1"}, true); len(res) != 2 {
		t.Fatalf("首次应推送 2 个通道, got %+v", res)
	}
	// 第二次: 冷却期内全部跳过
	if res := n.dispatch(ctx, n.Config(), n.EnabledChannels(n.Config()), Message{Title: "2"}, true); len(res) != 0 {
		t.Fatalf("冷却期内应全部跳过, got %+v", res)
	}
	if rec.count() != 2 {
		t.Errorf("冷却期内不应发请求, 共 %d 次", rec.count())
	}

	// 时间推进超过冷却期 → 重新放行
	n.now = func() time.Time { return time.Now().Add(61 * time.Second) }
	if res := n.dispatch(ctx, n.Config(), n.EnabledChannels(n.Config()), Message{Title: "3"}, true); len(res) != 2 {
		t.Fatalf("超过冷却期应重新推送, got %+v", res)
	}
	if rec.count() != 4 {
		t.Errorf("共应 4 次请求, got %d", rec.count())
	}
}

// 限流按通道独立计算: 一个通道冷却不影响另一个。
func TestCooldownIsIndependentPerChannel(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{
		CooldownSec: 60,
		Webhook:     config.WebhookConfig{Enabled: true, URL: ts.URL},
	})
	n.now = func() time.Time { return time.Unix(1000, 0) }
	if res := n.dispatch(context.Background(), n.Config(), []string{ChannelWebhook}, Message{Title: "a"}, true); len(res) != 1 {
		t.Fatal("首次应推送")
	}
	if res := n.dispatch(context.Background(), n.Config(), []string{ChannelDingTalk}, Message{Title: "b"}, true); len(res) != 1 {
		t.Fatalf("另一通道不应被限流: %+v", res)
	}
}

// 失败也占用冷却窗口, 避免故障通道被事件刷屏重试。
func TestCooldownAppliesOnFailure(t *testing.T) {
	rec := &recorder{fail: true}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{CooldownSec: 60, Webhook: config.WebhookConfig{Enabled: true, URL: ts.URL}})
	if res := n.dispatch(context.Background(), n.Config(), []string{ChannelWebhook}, Message{}, true); len(res) != 1 || res[0].OK {
		t.Fatal("首次应尝试并失败")
	}
	if res := n.dispatch(context.Background(), n.Config(), []string{ChannelWebhook}, Message{}, true); len(res) != 0 {
		t.Errorf("失败后冷却期内应跳过, got %+v", res)
	}
	if rec.count() != 1 {
		t.Errorf("只应发出 1 次请求, got %d", rec.count())
	}
}

// 测试按钮不受限流约束(否则刚推过告警就点不动测试)。
func TestSendChannelIgnoresCooldown(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{CooldownSec: 3600, Webhook: config.WebhookConfig{Enabled: true, URL: ts.URL}})
	ctx := context.Background()
	n.SendChannel(ctx, ChannelWebhook, Message{Title: "1"})
	n.SendChannel(ctx, ChannelWebhook, Message{Title: "2"})
	if rec.count() != 2 {
		t.Errorf("SendChannel 不应受限流, got %d 次请求", rec.count())
	}
}

func TestSendChannelValidation(t *testing.T) {
	n := New(config.NotifyConfig{})
	ctx := context.Background()

	res := n.SendChannel(ctx, "nope", Message{})
	if len(res) != 1 || res[0].OK || !strings.Contains(res[0].Error, "未知通道") {
		t.Errorf("未知通道应报错: %+v", res)
	}
	res = n.SendChannel(ctx, ChannelBark, Message{})
	if len(res) != 1 || res[0].OK || !strings.Contains(res[0].Error, "未启用") {
		t.Errorf("未启用通道应报错: %+v", res)
	}
	if res := n.SendChannel(ctx, "", Message{}); len(res) != 0 {
		t.Errorf("无启用通道时应返回空结果, got %+v", res)
	}
}

func TestBarkUsesServerAndPushPath(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{Bark: config.BarkConfig{Enabled: true, Server: ts.URL + "/", DeviceKey: "dk"}})
	if res := n.SendChannel(context.Background(), ChannelBark, Message{Title: "t", Body: "b"}); !res[0].OK {
		t.Fatalf("Bark 推送应成功: %+v", res)
	}
	got := rec.last()
	if got.path != "/push" {
		t.Errorf("path = %q, want /push", got.path)
	}
	var payload map[string]any
	_ = json.Unmarshal(got.body, &payload)
	if payload["device_key"] != "dk" || payload["title"] != "t" {
		t.Errorf("payload 不符: %v", payload)
	}
}

func TestTelegramText(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{Telegram: config.TelegramConfig{Enabled: true, BotToken: "TOK", ChatID: "42"}})
	n.apiBase = ts.URL

	if res := n.SendChannel(context.Background(), ChannelTelegram, Message{Title: "t", Body: "b"}); !res[0].OK {
		t.Fatalf("Telegram 推送应成功: %+v", res)
	}
	got := rec.last()
	if got.path != "/botTOK/sendMessage" {
		t.Errorf("path = %q", got.path)
	}
	var payload map[string]any
	_ = json.Unmarshal(got.body, &payload)
	if payload["chat_id"] != "42" || !strings.Contains(payload["text"].(string), "b") {
		t.Errorf("payload 不符: %v", payload)
	}
}

func TestTelegramPhotoMultipart(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	dir := t.TempDir()
	img := filepath.Join(dir, "ev.jpg")
	if err := os.WriteFile(img, []byte("JPEGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}

	n := New(config.NotifyConfig{Telegram: config.TelegramConfig{Enabled: true, BotToken: "TOK", ChatID: "42"}})
	n.apiBase = ts.URL

	if res := n.SendChannel(context.Background(), ChannelTelegram, Message{Title: "t", Body: "b", ImagePath: img}); !res[0].OK {
		t.Fatalf("Telegram 发图应成功: %+v", res)
	}
	got := rec.last()
	if got.path != "/botTOK/sendPhoto" {
		t.Fatalf("path = %q, want sendPhoto", got.path)
	}
	if ct := got.header.Get("Content-Type"); !strings.HasPrefix(ct, "multipart/form-data") {
		t.Errorf("Content-Type = %q", ct)
	}
	if !strings.Contains(string(got.body), "JPEGDATA") || !strings.Contains(string(got.body), "chat_id") {
		t.Errorf("multipart 内容不符: %s", got.body)
	}
}

// 图片不存在时回退纯文本, 而不是整条通知失败。
func TestTelegramPhotoFallbackToText(t *testing.T) {
	rec := &recorder{}
	ts := httptest.NewServer(rec.handler())
	defer ts.Close()

	n := New(config.NotifyConfig{Telegram: config.TelegramConfig{Enabled: true, BotToken: "TOK", ChatID: "42"}})
	n.apiBase = ts.URL

	res := n.SendChannel(context.Background(), ChannelTelegram, Message{Title: "t", Body: "b", ImagePath: filepath.Join(t.TempDir(), "missing.jpg")})
	if !res[0].OK {
		t.Fatalf("应回退文本并成功: %+v", res)
	}
	if rec.last().path != "/botTOK/sendMessage" {
		t.Errorf("应回退 sendMessage, got %q", rec.last().path)
	}
}

// Send 走异步队列: 队列满时必须丢弃而不是阻塞调用方。
func TestSendIsNonBlockingWhenQueueFull(t *testing.T) {
	n := New(config.NotifyConfig{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < queueSize*4; i++ {
			n.Send(Message{Title: fmt.Sprint(i)})
		}
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Send 阻塞了调用方")
	}
}

func TestUpdateTakesEffect(t *testing.T) {
	n := New(config.NotifyConfig{})
	if len(n.EnabledChannels(n.Config())) != 0 {
		t.Fatal("初始无启用通道")
	}
	n.Update(config.NotifyConfig{Webhook: config.WebhookConfig{Enabled: true, URL: "https://x"}})
	if got := n.EnabledChannels(n.Config()); len(got) != 1 || got[0] != ChannelWebhook {
		t.Errorf("Update 后应启用 webhook, got %v", got)
	}
}
