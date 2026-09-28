// Package bot 实现 C6 Telegram 双向控制 Bot(long polling)。
// 设计见 docs/contracts/api-v1.1.md §2.6。
//
// 约束:
//   - getUpdates 长轮询 30s 超时, ctx 取消即退出(进程可优雅关闭);
//   - 命令仅对 bot.allowed_users 白名单内的数字用户 ID 生效, 空白名单=拒绝所有;
//   - bot token / enabled / 白名单变化时重建轮询循环(契约 §2.7)。
package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"camhub/internal/config"
	"camhub/internal/store"
)

// defaultAPIBase Telegram Bot API 根地址(测试可覆盖)。
const defaultAPIBase = "https://api.telegram.org"

// pollTimeout 契约 §2.6 规定的 getUpdates 长轮询超时。
const pollTimeout = 30 * time.Second

// httpTimeout 必须大于 pollTimeout, 否则长轮询会被客户端超时打断。
const httpTimeout = pollTimeout + 10*time.Second

// retryDelay 轮询失败后的重试间隔。
const retryDelay = 3 * time.Second

// idlePoll 未启用时等待配置变化的最长时间。
const idlePoll = 5 * time.Second

// eventsDefaultN /events 不带参数时返回的条数。
const eventsDefaultN = 5

// eventsMaxN /events 参数上限, 避免一次拉爆消息长度。
const eventsMaxN = 20

// telegramMaxText Telegram 单条消息长度上限(超出会被 API 拒绝)。
const telegramMaxText = 4000

// App Bot 需要的应用能力, 由 pipeline 实现(避免 bot 反向依赖 pipeline)。
type App interface {
	StatusText() string
	SetArmed(armed bool)
	SnapshotJPEG() ([]byte, error)
	RecentEvents(n int) []store.Event
}

// Bot Telegram 双向控制; Run 阻塞直到 ctx 取消。
type Bot struct {
	app     App
	client  *http.Client
	apiBase string

	mu      sync.Mutex
	cfg     config.BotConfig
	changed chan struct{}
}

// New 创建 Bot。
func New(cfg config.BotConfig, app App) *Bot {
	return &Bot{
		app:     app,
		client:  &http.Client{Timeout: httpTimeout},
		apiBase: defaultAPIBase,
		cfg:     cfg,
		changed: make(chan struct{}, 1),
	}
}

// Update 热更新配置; token/enabled/白名单变化会通知轮询循环重建。
func (b *Bot) Update(cfg config.BotConfig) {
	b.mu.Lock()
	old := b.cfg
	b.cfg = cfg
	b.mu.Unlock()
	if old.Enabled == cfg.Enabled && old.BotToken == cfg.BotToken && sameUsers(old.AllowedUsers, cfg.AllowedUsers) {
		return
	}
	select {
	case b.changed <- struct{}{}:
	default:
	}
}

// Config 返回当前配置副本。
func (b *Bot) Config() config.BotConfig {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cfg
}

// Run 阻塞运行: 未启用时待机, 启用时轮询; 配置变化或 ctx 取消都会重建/退出。
func (b *Bot) Run(ctx context.Context) {
	for {
		cfg := b.Config()
		if !cfg.Enabled || cfg.BotToken == "" {
			if !b.waitChange(ctx, idlePoll) {
				return
			}
			continue
		}

		pctx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			b.poll(pctx, cfg)
		}()

		select {
		case <-ctx.Done():
			cancel()
			<-done
			return
		case <-b.changed:
			cancel()
			<-done
			slog.Info("Bot 配置变更, 重建轮询")
		}
	}
}

// waitChange 等待配置变化 / 超时 / ctx 取消; 返回 false 表示应退出。
func (b *Bot) waitChange(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-b.changed:
		return true
	case <-t.C:
		return true
	}
}

// poll 长轮询循环, 直到 ctx 取消。
func (b *Bot) poll(ctx context.Context, cfg config.BotConfig) {
	offset := 0
	slog.Info("Bot 轮询已启动", "allowed_users", len(cfg.AllowedUsers))
	defer slog.Info("Bot 轮询已停止")
	for ctx.Err() == nil {
		ups, err := b.getUpdates(ctx, cfg.BotToken, offset)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Warn("Telegram getUpdates 失败", "err", err)
			if !sleepCtx(ctx, retryDelay) {
				return
			}
			continue
		}
		for _, u := range ups {
			if u.UpdateID >= int64(offset) {
				offset = int(u.UpdateID) + 1
			}
			b.handle(ctx, cfg, u)
		}
	}
}

// handle 处理单条更新: 白名单校验 → 命令分发 → 回复。
func (b *Bot) handle(ctx context.Context, cfg config.BotConfig, u update) {
	if u.Message == nil || strings.TrimSpace(u.Message.Text) == "" {
		return
	}
	userID := strconv.FormatInt(u.Message.From.ID, 10)
	chatID := u.Message.Chat.ID
	if !allowed(cfg.AllowedUsers, userID) {
		slog.Warn("Bot 拒绝未授权用户", "user_id", userID)
		return
	}

	cmd, arg := ParseCommand(u.Message.Text)
	switch cmd {
	case "":
		return
	case "help":
		b.reply(ctx, cfg.BotToken, chatID, helpText())
	case "status":
		b.reply(ctx, cfg.BotToken, chatID, b.app.StatusText())
	case "arm":
		b.app.SetArmed(true)
		b.reply(ctx, cfg.BotToken, chatID, "已布防")
	case "disarm":
		b.app.SetArmed(false)
		b.reply(ctx, cfg.BotToken, chatID, "已撤防")
	case "snap":
		jpg, err := b.app.SnapshotJPEG()
		if err != nil {
			b.reply(ctx, cfg.BotToken, chatID, "抓拍失败: "+err.Error())
			return
		}
		if err := b.sendPhoto(ctx, cfg.BotToken, chatID, jpg, "当前画面"); err != nil {
			b.reply(ctx, cfg.BotToken, chatID, "发送图片失败: "+err.Error())
		}
	case "events":
		n := parseCount(arg)
		b.reply(ctx, cfg.BotToken, chatID, formatEvents(b.app.RecentEvents(n)))
	default:
		b.reply(ctx, cfg.BotToken, chatID, "未知命令, 发送 /help 查看用法")
	}
}

func helpText() string {
	return strings.Join([]string{
		"camhub 控制命令:",
		"/status - 查看运行状态",
		"/arm - 布防",
		"/disarm - 撤防",
		"/snap - 抓拍当前画面",
		fmt.Sprintf("/events [n] - 最近 n 条事件(默认 %d, 最多 %d)", eventsDefaultN, eventsMaxN),
		"/help - 显示本帮助",
	}, "\n")
}

// ParseCommand 解析 "/cmd"、"/cmd@botname"、"/cmd arg" 形式, 命令统一小写。
func ParseCommand(text string) (cmd, arg string) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "/") {
		return "", ""
	}
	fields := strings.Fields(text)
	head := strings.TrimPrefix(fields[0], "/")
	if i := strings.IndexByte(head, '@'); i >= 0 {
		head = head[:i] // 群聊里带 @botname 后缀
	}
	if len(fields) > 1 {
		arg = fields[1]
	}
	return strings.ToLower(head), arg
}

// parseCount 解析 /events 的条数参数, 非法值回退默认。
func parseCount(arg string) int {
	n, err := strconv.Atoi(strings.TrimSpace(arg))
	if err != nil || n <= 0 {
		return eventsDefaultN
	}
	if n > eventsMaxN {
		return eventsMaxN
	}
	return n
}

func formatEvents(evs []store.Event) string {
	if len(evs) == 0 {
		return "暂无事件"
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "最近 %d 条事件:\n", len(evs))
	for _, ev := range evs {
		fmt.Fprintf(&sb, "#%d %s %s", ev.ID, ev.Time.Format("01-02 15:04:05"), eventLabel(ev))
		if ev.Score > 0 {
			fmt.Fprintf(&sb, " 得分 %d", ev.Score)
		}
		sb.WriteByte('\n')
	}
	return strings.TrimRight(sb.String(), "\n")
}

// eventLabel 事件标签与前端渲染口径一致(契约 §3.4)。
func eventLabel(ev store.Event) string {
	switch ev.Type {
	case "selfcheck":
		if ev.Detail == "occlusion" {
			return "画面异常"
		}
		return "画面冻结"
	case "motion":
		return "移动侦测"
	default:
		return ev.Type
	}
}

// allowed 白名单校验: 空名单拒绝所有(契约 §1 bot.allowed_users)。
func allowed(users []string, id string) bool {
	for _, u := range users {
		if u == id {
			return true
		}
	}
	return false
}

func sameUsers(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ---- Telegram API ----

type update struct {
	UpdateID int64    `json:"update_id"`
	Message  *message `json:"message"`
}

type message struct {
	MessageID int64  `json:"message_id"`
	Text      string `json:"text"`
	From      user   `json:"from"`
	Chat      chat   `json:"chat"`
}

type user struct {
	ID int64 `json:"id"`
}

type chat struct {
	ID int64 `json:"id"`
}

type apiResponse struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"`
}

func (b *Bot) getUpdates(ctx context.Context, token string, offset int) ([]update, error) {
	target := fmt.Sprintf("%s/bot%s/getUpdates?timeout=%d&offset=%d",
		b.apiBase, token, int(pollTimeout/time.Second), offset)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	var resp apiResponse
	if err := b.do(req, &resp); err != nil {
		return nil, err
	}
	var ups []update
	if len(resp.Result) > 0 {
		if err := json.Unmarshal(resp.Result, &ups); err != nil {
			return nil, fmt.Errorf("解析 getUpdates 结果: %w", err)
		}
	}
	return ups, nil
}

func (b *Bot) reply(ctx context.Context, token string, chatID int64, text string) {
	body := map[string]any{
		"chat_id":                  chatID,
		"text":                     truncateText(text, telegramMaxText),
		"disable_web_page_preview": true,
	}
	if err := b.postJSON(ctx, fmt.Sprintf("%s/bot%s/sendMessage", b.apiBase, token), body); err != nil {
		slog.Warn("Bot 回复失败", "err", err)
	}
}

func (b *Bot) sendPhoto(ctx context.Context, token string, chatID int64, jpg []byte, caption string) error {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("chat_id", strconv.FormatInt(chatID, 10)); err != nil {
		return err
	}
	if caption != "" {
		if err := mw.WriteField("caption", caption); err != nil {
			return err
		}
	}
	part, err := mw.CreateFormFile("photo", "snapshot.jpg")
	if err != nil {
		return err
	}
	if _, err := part.Write(jpg); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/bot%s/sendPhoto", b.apiBase, token), &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	var resp apiResponse
	return b.do(req, &resp)
}

func (b *Bot) postJSON(ctx context.Context, target string, body any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	var resp apiResponse
	return b.do(req, &resp)
}

// do 执行请求并校验 HTTP 状态与 Telegram 的 ok 字段。
func (b *Bot) do(req *http.Request, out *apiResponse) error {
	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncateText(string(data), 200))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("解析响应: %w", err)
	}
	if !out.OK {
		return fmt.Errorf("Telegram 返回错误: %s", out.Description)
	}
	return nil
}

func truncateText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
