// Package notify 事件通知中心: 钉钉/企微/Telegram/Bark/Webhook 五通道 fan-out + 同通道限流。
// 设计见 docs/contracts/api-v1.1.md §1(notify) 与 §2(运行时语义)。
//
// 关键约束:
//   - 推送不得阻塞调用方(侦测循环), 因此 Send 走内部队列异步派发;
//     API 的「发送测试」需要即时结果, 用 SendChannel 同步派发。
//   - 同一通道两次推送间隔不得小于 notify.cooldown_sec(限流)。
//   - 通道未启用 / 配置不完整一律跳过, 不产生网络请求。
package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"camhub/internal/config"
)

// 通道名(与契约 notify.* 子键一致, 也是 /api/notify/test 的 channel 取值)。
const (
	ChannelDingTalk = "dingtalk"
	ChannelWecom    = "wecom"
	ChannelTelegram = "telegram"
	ChannelBark     = "bark"
	ChannelWebhook  = "webhook"
)

// AllChannels 全部通道, 顺序即 /api/notify/test 空 channel 时的派发顺序。
var AllChannels = []string{ChannelDingTalk, ChannelWecom, ChannelTelegram, ChannelBark, ChannelWebhook}

// defaultAPIBase Telegram Bot API 根地址(测试可覆盖)。
const defaultAPIBase = "https://api.telegram.org"

// requestTimeout 单次外发请求超时。
const requestTimeout = 10 * time.Second

// queueSize 异步队列长度; 满时丢弃新消息并告警, 不阻塞调用方。
const queueSize = 64

// Message 一条待推送消息。
type Message struct {
	Title     string
	Body      string
	ImagePath string // 本地图片路径(telegram 作为照片发送), 可选
	ImageURL  string // 外链图片(webhook 附带), 可选
	Link      string // 点击跳转链接, 可选
}

// Result 单个通道的推送结果。
type Result struct {
	Channel string `json:"channel"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
}

// Notifier 通知中心。
type Notifier struct {
	client  *http.Client
	apiBase string
	queue   chan Message
	now     func() time.Time

	mu       sync.Mutex
	cfg      config.NotifyConfig
	lastSent map[string]time.Time
}

// New 创建通知中心(不启动后台 goroutine, 需再调用 Run)。
func New(cfg config.NotifyConfig) *Notifier {
	return &Notifier{
		client:   &http.Client{Timeout: requestTimeout},
		apiBase:  defaultAPIBase,
		queue:    make(chan Message, queueSize),
		now:      time.Now,
		cfg:      cfg,
		lastSent: make(map[string]time.Time),
	}
}

// Run 阻塞消费异步队列直到 ctx 取消(调用方负责放进自己的 goroutine)。
func (n *Notifier) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-n.queue:
			n.dispatch(ctx, n.Config(), n.EnabledChannels(n.Config()), msg, true)
		}
	}
}

// Update 热更新配置(契约 §2.7)。
func (n *Notifier) Update(cfg config.NotifyConfig) {
	n.mu.Lock()
	n.cfg = cfg
	n.mu.Unlock()
}

// Config 返回当前配置副本。
func (n *Notifier) Config() config.NotifyConfig {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.cfg
}

// Send 异步向全部启用通道推送(受限流); 队列满时丢弃并告警, 绝不阻塞调用方。
func (n *Notifier) Send(msg Message) {
	select {
	case n.queue <- msg:
	default:
		slog.Warn("通知队列已满, 丢弃本次推送", "title", msg.Title)
	}
}

// SendChannel 同步向指定通道推送并返回结果, channel 为空表示全部启用通道。
// 供 POST /api/notify/test 使用, 不受限流约束(否则刚推过告警就点不动测试按钮)。
func (n *Notifier) SendChannel(ctx context.Context, channel string, msg Message) []Result {
	cfg := n.Config()
	var channels []string
	if channel == "" {
		channels = n.EnabledChannels(cfg)
	} else if !validChannel(channel) {
		return []Result{{Channel: channel, OK: false, Error: "未知通道"}}
	} else if !channelEnabled(cfg, channel) {
		return []Result{{Channel: channel, OK: false, Error: "通道未启用或配置不完整"}}
	} else {
		channels = []string{channel}
	}
	return n.dispatch(ctx, cfg, channels, msg, false)
}

// EnabledChannels 返回配置完整且已启用的通道。
func (n *Notifier) EnabledChannels(cfg config.NotifyConfig) []string {
	out := make([]string, 0, len(AllChannels))
	for _, ch := range AllChannels {
		if channelEnabled(cfg, ch) {
			out = append(out, ch)
		}
	}
	return out
}

// dispatch 依次派发; respectCooldown 为 true 时限流命中的通道直接跳过(不返回结果)。
func (n *Notifier) dispatch(ctx context.Context, cfg config.NotifyConfig, channels []string, msg Message, respectCooldown bool) []Result {
	results := make([]Result, 0, len(channels))
	for _, ch := range channels {
		if respectCooldown && !n.acquire(ch, cfg.CooldownSec) {
			continue
		}
		err := n.sendOne(ctx, cfg, ch, msg)
		res := Result{Channel: ch, OK: err == nil}
		if err != nil {
			res.Error = err.Error()
			slog.Warn("通知推送失败", "channel", ch, "err", err)
		} else {
			slog.Info("通知已推送", "channel", ch, "title", msg.Title)
		}
		results = append(results, res)
	}
	return results
}

// acquire 限流: 距离上次尝试不足 cooldown 秒则返回 false。
// 无论成功失败都记录时间戳, 保证故障通道也不会被事件刷屏重试。
func (n *Notifier) acquire(channel string, cooldownSec int) bool {
	if cooldownSec <= 0 {
		return true
	}
	now := n.now()
	n.mu.Lock()
	defer n.mu.Unlock()
	if last, ok := n.lastSent[channel]; ok && now.Sub(last) < time.Duration(cooldownSec)*time.Second {
		return false
	}
	n.lastSent[channel] = now
	return true
}

func (n *Notifier) sendOne(ctx context.Context, cfg config.NotifyConfig, channel string, msg Message) error {
	switch channel {
	case ChannelDingTalk:
		return n.sendDingTalk(ctx, cfg.DingTalk, msg)
	case ChannelWecom:
		return n.sendWecom(ctx, cfg.Wecom, msg)
	case ChannelTelegram:
		return n.sendTelegram(ctx, cfg.Telegram, msg)
	case ChannelBark:
		return n.sendBark(ctx, cfg.Bark, msg)
	case ChannelWebhook:
		return n.sendWebhook(ctx, cfg.Webhook, msg)
	default:
		return fmt.Errorf("未知通道 %q", channel)
	}
}

func validChannel(ch string) bool {
	for _, c := range AllChannels {
		if c == ch {
			return true
		}
	}
	return false
}

// channelEnabled 通道已启用且必填项非空; 缺配置视为未启用, 不产生请求。
func channelEnabled(cfg config.NotifyConfig, ch string) bool {
	switch ch {
	case ChannelDingTalk:
		return cfg.DingTalk.Enabled && cfg.DingTalk.Webhook != ""
	case ChannelWecom:
		return cfg.Wecom.Enabled && cfg.Wecom.Webhook != ""
	case ChannelTelegram:
		return cfg.Telegram.Enabled && cfg.Telegram.BotToken != "" && cfg.Telegram.ChatID != ""
	case ChannelBark:
		return cfg.Bark.Enabled && cfg.Bark.DeviceKey != ""
	case ChannelWebhook:
		return cfg.Webhook.Enabled && cfg.Webhook.URL != ""
	}
	return false
}

// ---- 各通道实现 ----

// sendDingTalk 钉钉自定义机器人 markdown 消息; 配置 secret 时按官方规则加签。
func (n *Notifier) sendDingTalk(ctx context.Context, cfg config.DingTalkConfig, msg Message) error {
	target := cfg.Webhook
	if cfg.Secret != "" {
		ts := strconv.FormatInt(n.now().UnixMilli(), 10)
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		target += sep + "timestamp=" + ts + "&sign=" + url.QueryEscape(DingTalkSign(ts, cfg.Secret))
	}
	body := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": msg.Title,
			"text":  joinText(msg),
		},
	}
	return n.postJSON(ctx, target, body, nil, true)
}

// DingTalkSign 钉钉加签: base64(HMAC-SHA256(timestamp+"\n"+secret, secret))。
func DingTalkSign(timestamp, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "\n" + secret))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// sendWecom 企业微信群机器人文本消息。
func (n *Notifier) sendWecom(ctx context.Context, cfg config.WecomConfig, msg Message) error {
	body := map[string]any{
		"msgtype": "text",
		"text":    map[string]string{"content": joinText(msg)},
	}
	return n.postJSON(ctx, cfg.Webhook, body, nil, true)
}

// sendTelegram 有本地图片时发照片(附 caption), 否则发纯文本。
func (n *Notifier) sendTelegram(ctx context.Context, cfg config.TelegramConfig, msg Message) error {
	if msg.ImagePath != "" {
		if err := n.telegramPhoto(ctx, cfg, msg); err == nil {
			return nil
		} else {
			slog.Warn("Telegram 发图失败, 回退文本", "err", err)
		}
	}
	return n.telegramText(ctx, cfg, msg)
}

func (n *Notifier) telegramText(ctx context.Context, cfg config.TelegramConfig, msg Message) error {
	body := map[string]any{
		"chat_id":                  cfg.ChatID,
		"text":                     joinText(msg),
		"disable_web_page_preview": true,
	}
	return n.postJSON(ctx, n.apiBase+"/bot"+cfg.BotToken+"/sendMessage", body, nil, false)
}

func (n *Notifier) telegramPhoto(ctx context.Context, cfg config.TelegramConfig, msg Message) error {
	f, err := os.Open(msg.ImagePath)
	if err != nil {
		return fmt.Errorf("打开图片: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("chat_id", cfg.ChatID); err != nil {
		return err
	}
	if err := mw.WriteField("caption", joinText(msg)); err != nil {
		return err
	}
	part, err := mw.CreateFormFile("photo", filepath.Base(msg.ImagePath))
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, f); err != nil {
		return fmt.Errorf("读取图片: %w", err)
	}
	if err := mw.Close(); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		n.apiBase+"/bot"+cfg.BotToken+"/sendPhoto", &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return n.do(req, false)
}

// sendBark Bark 推送(POST {server}/push)。
func (n *Notifier) sendBark(ctx context.Context, cfg config.BarkConfig, msg Message) error {
	server := strings.TrimRight(cfg.Server, "/")
	if server == "" {
		server = config.DefaultBarkServer
	}
	body := map[string]any{
		"device_key": cfg.DeviceKey,
		"title":      msg.Title,
		"body":       msg.Body,
		"group":      "camhub",
	}
	if msg.Link != "" {
		body["url"] = msg.Link
	}
	return n.postJSON(ctx, server+"/push", body, nil, true)
}

// sendWebhook 通用 Webhook: POST JSON, 配置 secret 时附带 HMAC-SHA256 签名头。
func (n *Notifier) sendWebhook(ctx context.Context, cfg config.WebhookConfig, msg Message) error {
	body := map[string]any{
		"title":     msg.Title,
		"body":      msg.Body,
		"image_url": msg.ImageURL,
		"link":      msg.Link,
		"time":      n.now().Format(time.RFC3339),
	}
	return n.postJSON(ctx, cfg.URL, body, func(raw []byte) map[string]string {
		if cfg.Secret == "" {
			return nil
		}
		mac := hmac.New(sha256.New, []byte(cfg.Secret))
		mac.Write(raw)
		return map[string]string{"X-Camhub-Signature": "sha256=" + hex.EncodeToString(mac.Sum(nil))}
	}, true)
}

// ---- HTTP 工具 ----

// postJSON 序列化并 POST; signer 用于附加签名头。
// checkBizErr 为 true 时解析钉钉/企微的 errcode 业务错误。
func (n *Notifier) postJSON(ctx context.Context, target string, body any, signer func([]byte) map[string]string, checkBizErr bool) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("序列化请求体: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("构造请求: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	if signer != nil {
		for k, v := range signer(raw) {
			req.Header.Set(k, v)
		}
	}
	return n.do(req, checkBizErr)
}

// do 执行请求并校验状态码; checkBizErr 时额外校验 {"errcode":N} 业务错误。
func (n *Notifier) do(req *http.Request, checkBizErr bool) error {
	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(data), 200))
	}
	if checkBizErr {
		var biz struct {
			ErrCode *int   `json:"errcode"`
			ErrMsg  string `json:"errmsg"`
		}
		if err := json.Unmarshal(data, &biz); err == nil && biz.ErrCode != nil && *biz.ErrCode != 0 {
			return fmt.Errorf("业务错误 errcode=%d: %s", *biz.ErrCode, biz.ErrMsg)
		}
	}
	return nil
}

func joinText(msg Message) string {
	if msg.Body == "" {
		return msg.Title
	}
	if msg.Title == "" {
		return msg.Body
	}
	return msg.Title + "\n" + msg.Body
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
