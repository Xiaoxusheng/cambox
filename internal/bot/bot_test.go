package bot

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"camhub/internal/config"
	"camhub/internal/store"
)

type fakeApp struct {
	mu         sync.Mutex
	armed      bool
	statusText string
	snapErr    error
	eventsN    int
	events     []store.Event
}

func (f *fakeApp) StatusText() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.statusText
}

func (f *fakeApp) SetArmed(v bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.armed = v
}

func (f *fakeApp) SnapshotJPEG() ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.snapErr != nil {
		return nil, f.snapErr
	}
	return []byte("JPEGBYTES"), nil
}

func (f *fakeApp) RecentEvents(n int) []store.Event {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.eventsN = n
	if len(f.events) > n {
		return f.events[:n]
	}
	return f.events
}

func (f *fakeApp) isArmed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.armed
}

func (f *fakeApp) lastEventsN() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.eventsN
}

// fakeTG 模拟 Telegram Bot API。
type fakeTG struct {
	mu       sync.Mutex
	updates  [][]update // 每次 getUpdates 返回一批
	callN    int
	texts    []string
	photos   int
	offsets  []string
	failNext bool
}

func (f *fakeTG) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case strings.HasSuffix(r.URL.Path, "/getUpdates"):
			f.offsets = append(f.offsets, r.URL.Query().Get("offset"))
			if f.failNext {
				f.failNext = false
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"ok":false,"description":"boom"}`))
				return
			}
			batch := []update{}
			if f.callN < len(f.updates) {
				batch = f.updates[f.callN]
			}
			f.callN++
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": batch})
		case strings.HasSuffix(r.URL.Path, "/sendMessage"):
			body, _ := io.ReadAll(r.Body)
			var payload struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(body, &payload)
			f.texts = append(f.texts, payload.Text)
			_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
		case strings.HasSuffix(r.URL.Path, "/sendPhoto"):
			f.photos++
			_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}
}

func (f *fakeTG) textCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.texts)
}

func (f *fakeTG) lastText() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.texts) == 0 {
		return ""
	}
	return f.texts[len(f.texts)-1]
}

func (f *fakeTG) photoCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.photos
}

// callCount getUpdates 调用次数。
//
// 注意：handler 跑在 httptest 服务端 goroutine 里，任何字段读取都必须走带锁的
// 访问器，否则 `go test -race` 会在测试自身报数据竞争（测试假服务的竞争会让
// 真正的产品竞态被淹没）。
func (f *fakeTG) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.callN
}

// textsSnapshot 已发送文本的副本。
func (f *fakeTG) textsSnapshot() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.texts...)
}

// offsetsSnapshot 收到的 offset 参数副本。
func (f *fakeTG) offsetsSnapshot() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.offsets...)
}

func msg(updateID, userID, chatID int64, text string) update {
	return update{
		UpdateID: updateID,
		Message: &message{
			MessageID: updateID,
			Text:      text,
			From:      user{ID: userID},
			Chat:      chat{ID: chatID},
		},
	}
}

func newTestBot(t *testing.T, cfg config.BotConfig, app App, tg *fakeTG) (*Bot, *httptest.Server) {
	t.Helper()
	ts := httptest.NewServer(tg.handler())
	b := New(cfg, app)
	b.apiBase = ts.URL
	return b, ts
}

// runPoll 在后台跑 poll, 等到 cond 成立或超时。
func runPoll(t *testing.T, b *Bot, cfg config.BotConfig, cond func() bool) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); b.poll(ctx, cfg) }()
	deadline := time.After(15 * time.Second)
	for !cond() {
		select {
		case <-deadline:
			cancel()
			<-done
			t.Fatal("等待条件超时")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("poll 未随 ctx 取消退出")
	}
}

// ---- 命令解析 ----

func TestParseCommand(t *testing.T) {
	cases := []struct {
		in, cmd, arg string
	}{
		{"/status", "status", ""},
		{"/STATUS", "status", ""},
		{"/status@camhub_bot", "status", ""},
		{"/events 10", "events", "10"},
		{"/events@camhub_bot 3", "events", "3"},
		{"  /arm  ", "arm", ""},
		{"hello", "", ""},
		{"", "", ""},
		{"/", "", ""},
	}
	for _, tc := range cases {
		cmd, arg := ParseCommand(tc.in)
		if cmd != tc.cmd || arg != tc.arg {
			t.Errorf("ParseCommand(%q) = (%q,%q), want (%q,%q)", tc.in, cmd, arg, tc.cmd, tc.arg)
		}
	}
}

func TestParseCount(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", eventsDefaultN},
		{"3", 3},
		{"0", eventsDefaultN},
		{"-1", eventsDefaultN},
		{"abc", eventsDefaultN},
		{"999", eventsMaxN},
	}
	for _, tc := range cases {
		if got := parseCount(tc.in); got != tc.want {
			t.Errorf("parseCount(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestEventLabelMatchesFrontend(t *testing.T) {
	cases := []struct {
		ev   store.Event
		want string
	}{
		{store.Event{Type: "motion"}, "移动侦测"},
		{store.Event{Type: "selfcheck", Detail: "frozen"}, "画面冻结"},
		{store.Event{Type: "selfcheck", Detail: "occlusion"}, "画面异常"},
		{store.Event{Type: "other"}, "other"},
	}
	for _, tc := range cases {
		if got := eventLabel(tc.ev); got != tc.want {
			t.Errorf("eventLabel(%+v) = %q, want %q", tc.ev, got, tc.want)
		}
	}
}

// ---- 白名单 ----

func TestWhitelistRejectsUnknownUser(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 999, 42, "/arm")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.callCount() > 1 })
	if app.isArmed() {
		t.Error("未授权用户不得触发 /arm")
	}
	if tg.textCount() != 0 {
		t.Errorf("未授权用户不应收到任何回复, got %v", tg.textsSnapshot())
	}
}

func TestEmptyWhitelistRejectsEveryone(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/disarm")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: nil}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.callCount() > 1 })
	if tg.textCount() != 0 {
		t.Errorf("空白名单应拒绝所有, got %v", tg.textsSnapshot())
	}
}

// ---- 命令行为 ----

func TestCommandArmDisarm(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/arm"), msg(2, 111, 42, "/disarm")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.textCount() >= 2 })
	if app.isArmed() {
		t.Error("最后一条是 /disarm, 应处于撤防")
	}
	texts := tg.textsSnapshot()
	if len(texts) < 2 || !strings.Contains(texts[0], "布防") || !strings.Contains(texts[1], "撤防") {
		t.Errorf("回复文本不符: %v", texts)
	}
}

func TestCommandStatusAndHelp(t *testing.T) {
	app := &fakeApp{statusText: "布防: 是\n连接: 在线"}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/status"), msg(2, 111, 42, "/help")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.textCount() >= 2 })
	texts := tg.textsSnapshot()
	if len(texts) < 2 || !strings.Contains(texts[0], "连接: 在线") {
		t.Errorf("/status 应回应用状态文本: %q", texts)
	}
	for _, cmd := range []string{"/status", "/arm", "/disarm", "/snap", "/events", "/help"} {
		if !strings.Contains(texts[1], cmd) {
			t.Errorf("/help 应包含 %s: %q", cmd, texts[1])
		}
	}
}

func TestCommandSnapSendsPhoto(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/snap")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.photoCount() > 0 })
	if tg.photoCount() != 1 {
		t.Errorf("应发送 1 张照片, got %d", tg.photoCount())
	}
}

func TestCommandSnapReportsFailure(t *testing.T) {
	app := &fakeApp{snapErr: errNoFrame}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/snap")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.textCount() > 0 })
	if !strings.Contains(tg.lastText(), "抓拍失败") {
		t.Errorf("抓拍失败应回文本提示, got %q", tg.lastText())
	}
}

func TestCommandEventsUsesArgAndFormats(t *testing.T) {
	app := &fakeApp{events: []store.Event{
		{ID: 7, Time: time.Date(2026, 9, 28, 15, 3, 0, 0, time.Local), Type: "motion", Score: 900},
		{ID: 6, Time: time.Date(2026, 9, 28, 14, 0, 0, 0, time.Local), Type: "selfcheck", Detail: "occlusion"},
	}}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/events 2")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.textCount() > 0 })
	if app.lastEventsN() != 2 {
		t.Errorf("应向 app 请求 2 条, got %d", app.lastEventsN())
	}
	text := tg.lastText()
	if !strings.Contains(text, "#7") || !strings.Contains(text, "移动侦测") ||
		!strings.Contains(text, "#6") || !strings.Contains(text, "画面异常") {
		t.Errorf("事件文本不符: %q", text)
	}
}

func TestCommandEventsEmpty(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/events")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.textCount() > 0 })
	if tg.lastText() != "暂无事件" {
		t.Errorf("无事件应回复「暂无事件」, got %q", tg.lastText())
	}
}

func TestUnknownCommandRepliesHelpHint(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "/nope")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.textCount() > 0 })
	if !strings.Contains(tg.lastText(), "未知命令") {
		t.Errorf("未知命令应提示 /help, got %q", tg.lastText())
	}
}

// 非命令文本不回复, 避免群里刷屏。
func TestPlainTextIgnored(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{{msg(1, 111, 42, "你好")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.callCount() > 1 })
	if tg.textCount() != 0 {
		t.Errorf("非命令文本不应回复, got %v", tg.textsSnapshot())
	}
}

// ---- 轮询语义 ----

func TestPollAdvancesOffset(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{updates: [][]update{
		{msg(10, 111, 42, "/status"), msg(11, 111, 42, "/help")},
	}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	runPoll(t, b, b.Config(), func() bool { return tg.callCount() > 1 })
	offsets := tg.offsetsSnapshot()
	if len(offsets) < 2 || offsets[0] != "0" || offsets[1] != "12" {
		t.Errorf("offset 应推进到 update_id+1, got %v", offsets)
	}
}

func TestPollRetriesAfterError(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{failNext: true, updates: [][]update{nil, {msg(1, 111, 42, "/arm")}}}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	// retryDelay=3s, 需要等一次重试
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); b.poll(ctx, b.Config()) }()
	deadline := time.After(18 * time.Second)
	for !app.isArmed() {
		select {
		case <-deadline:
			t.Fatal("失败后未重试成功")
		case <-time.After(20 * time.Millisecond):
		}
	}
	cancel()
	<-done
}

func TestRunIdlesWhenDisabled(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{}
	b, ts := newTestBot(t, config.BotConfig{Enabled: false, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); b.Run(ctx) }()
	time.Sleep(200 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
	if tg.callCount() != 0 {
		t.Errorf("未启用时不应轮询, got %d 次 getUpdates", tg.callCount())
	}
}

// 契约 §2.7: token 变化需重启 Bot 轮询。
func TestRunRestartsOnTokenChange(t *testing.T) {
	app := &fakeApp{}
	tg := &fakeTG{}
	b, ts := newTestBot(t, config.BotConfig{Enabled: true, BotToken: "TOK", AllowedUsers: []string{"111"}}, app, tg)
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); b.Run(ctx) }()

	deadline := time.After(15 * time.Second)
	for {
		if tg.callCount() > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("首次轮询未启动")
		case <-time.After(10 * time.Millisecond):
		}
	}

	b.Update(config.BotConfig{Enabled: true, BotToken: "TOK2", AllowedUsers: []string{"111"}})
	time.Sleep(200 * time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
	// token 变更后应重新轮询(调用次数继续增长)
	if tg.callCount() < 2 {
		t.Errorf("token 变化后应重建轮询, getUpdates 次数 = %d", tg.callCount())
	}
}

func TestUpdateNoRestartWhenOnlyIrrelevantFieldsChange(t *testing.T) {
	b := New(config.BotConfig{Enabled: true, BotToken: "T", AllowedUsers: []string{"1"}}, &fakeApp{})
	// 消费掉可能的信号
	select {
	case <-b.changed:
	default:
	}
	b.Update(config.BotConfig{Enabled: true, BotToken: "T", AllowedUsers: []string{"1"}})
	select {
	case <-b.changed:
		t.Error("无关字段变化不应触发轮询重建")
	default:
	}
	b.Update(config.BotConfig{Enabled: true, BotToken: "T2", AllowedUsers: []string{"1"}})
	select {
	case <-b.changed:
	default:
		t.Error("token 变化应触发轮询重建")
	}
}

var errNoFrame = &simpleErr{"暂无画面"}

type simpleErr struct{ s string }

func (e *simpleErr) Error() string { return e.s }
