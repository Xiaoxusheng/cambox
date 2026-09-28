package digest

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"camhub/internal/config"
	"camhub/internal/notify"
	"camhub/internal/store"
)

type fakeSender struct {
	mu   sync.Mutex
	msgs []notify.Message
}

func (f *fakeSender) Send(msg notify.Message) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.msgs = append(f.msgs, msg)
}

func (f *fakeSender) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.msgs)
}

func (f *fakeSender) last() notify.Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.msgs[len(f.msgs)-1]
}

func newStore(t *testing.T) *store.Store {
	t.Helper()
	return newStoreWithEvents(t)
}

// newStoreWithEvents 用带指定时间的事件构造 store: 写入 JSONL 后由 Open 载入,
// 避免依赖 store 的内部字段(只使用公开 API)。
func newStoreWithEvents(t *testing.T, events ...store.Event) *store.Store {
	t.Helper()
	dir := t.TempDir()
	if len(events) > 0 {
		var buf []byte
		for _, ev := range events {
			line, err := json.Marshal(ev)
			if err != nil {
				t.Fatal(err)
			}
			buf = append(buf, line...)
			buf = append(buf, '\n')
		}
		path := filepath.Join(dir, "events-seed.jsonl")
		if err := os.WriteFile(path, buf, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	st, err := store.Open(dir, 5000)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	return st
}

func TestBuildReportEmpty(t *testing.T) {
	from := time.Date(2026, 9, 27, 22, 0, 0, 0, time.Local)
	to := time.Date(2026, 9, 28, 22, 0, 0, 0, time.Local)
	title, body := BuildReport("2026-09-28", from, to, 0, [24]int{}, nil, "前门")
	if title != "camhub 日报 2026-09-28" {
		t.Errorf("标题 = %q", title)
	}
	if !strings.Contains(body, "今日无事发生") {
		t.Errorf("无事件应包含「今日无事发生」: %s", body)
	}
	if !strings.Contains(body, "前门") {
		t.Errorf("正文应含摄像头名: %s", body)
	}
}

func TestBuildReportWithEvents(t *testing.T) {
	from := time.Date(2026, 9, 27, 22, 0, 0, 0, time.Local)
	to := time.Date(2026, 9, 28, 22, 0, 0, 0, time.Local)

	var hourly [24]int
	hourly[8] = 3
	hourly[15] = 9
	top := &store.Event{ID: 42, Time: time.Date(2026, 9, 28, 15, 3, 0, 0, time.Local), Type: "selfcheck", Score: 900, Detail: "occlusion"}

	_, body := BuildReport("2026-09-28", from, to, 12, hourly, top, "前门")
	for _, want := range []string{
		"事件总数: 12", "08 时 3 条", "15 时 9 条",
		"最高分事件: #42", "得分 900", "occlusion", "2026-09-27 22:00", "2026-09-28 22:00",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("正文缺少 %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "今日无事发生") {
		t.Error("有事件时不应出现「今日无事发生」")
	}
	// 未出现的小时应省略, 避免 24 行 0
	if strings.Contains(body, "00 时") {
		t.Errorf("零事件小时不应列出:\n%s", body)
	}
}

func TestDueTime(t *testing.T) {
	cfg := config.DigestConfig{Enabled: true, Time: "22:00"}
	day := time.Date(2026, 9, 28, 0, 0, 0, 0, time.Local)

	if DueTime(cfg, day.Add(21*time.Hour+59*time.Minute)) {
		t.Error("21:59 未到点")
	}
	if !DueTime(cfg, day.Add(22*time.Hour)) {
		t.Error("22:00 应到点(闭区间)")
	}
	if !DueTime(cfg, day.Add(23*time.Hour+30*time.Minute)) {
		t.Error("23:30 应到点")
	}
	if DueTime(config.DigestConfig{Enabled: true, Time: "bogus"}, day.Add(23*time.Hour)) {
		t.Error("时间非法不应到点")
	}
	if !DueTime(config.DigestConfig{Enabled: true, Time: "00:00"}, day) {
		t.Error("00:00 在当天 00:00 应到点(闭区间)")
	}
}

func TestFirePushesOncePerDay(t *testing.T) {
	st := newStore(t)
	if _, err := st.Append("motion", 700, "/media/x.jpg", ""); err != nil {
		t.Fatal(err)
	}
	fs := &fakeSender{}
	r := New(config.DigestConfig{Enabled: true, Time: "22:00"}, st, fs, func() string { return "前门" })

	now := time.Date(2026, 9, 28, 22, 0, 0, 0, time.Local)
	if !r.Fire(now) {
		t.Fatal("首次应推送")
	}
	if r.Fire(now) {
		t.Error("同一天不应重复推送")
	}
	if r.Fire(now.Add(30 * time.Minute)) {
		t.Error("同一天晚些时候仍不应重复推送")
	}
	if fs.count() != 1 {
		t.Fatalf("应只推送 1 次, got %d", fs.count())
	}
	if !r.Fire(now.AddDate(0, 0, 1)) {
		t.Error("次日应再次推送")
	}
	if fs.count() != 2 {
		t.Errorf("共应推送 2 次, got %d", fs.count())
	}
}

func TestFireStatsWindowIsPast24h(t *testing.T) {
	now := time.Date(2026, 9, 28, 22, 0, 0, 0, time.Local)

	// 窗口内 2 条 + 窗口外 1 条(高分但不应计入)
	st := newStoreWithEvents(t,
		store.Event{ID: 3, Time: now.Add(-25 * time.Hour), Type: "motion", Score: 5000},
		store.Event{ID: 1, Time: now.Add(-23 * time.Hour), Type: "motion", Score: 100},
		store.Event{ID: 2, Time: now.Add(-1 * time.Hour), Type: "motion", Score: 900},
	)

	fs := &fakeSender{}
	r := New(config.DigestConfig{Enabled: true, Time: "22:00"}, st, fs, nil)
	if !r.Fire(now) {
		t.Fatal("应推送")
	}
	body := fs.last().Body
	if !strings.Contains(body, "事件总数: 2") {
		t.Errorf("只应统计窗口内 2 条:\n%s", body)
	}
	if strings.Contains(body, "5000") {
		t.Errorf("窗口外事件不应计入最高分:\n%s", body)
	}
	if !strings.Contains(body, "得分 900") {
		t.Errorf("最高分应为窗口内的 900:\n%s", body)
	}
}

// Run 在到点后必须真正推送, 且同一天不重复。
func TestRunSendsWhenDueAndStopsOnCancel(t *testing.T) {
	st := newStore(t)
	fs := &fakeSender{}
	r := New(config.DigestConfig{Enabled: true, Time: "22:00"}, st, fs, nil)
	r.tick = 20 * time.Millisecond
	r.now = func() time.Time { return time.Date(2026, 9, 28, 22, 30, 0, 0, time.Local) }

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); r.Run(ctx) }()

	deadline := time.After(15 * time.Second)
	for fs.count() == 0 {
		select {
		case <-deadline:
			t.Fatal("到点后 Run 未推送日报")
		case <-time.After(10 * time.Millisecond):
		}
	}
	time.Sleep(100 * time.Millisecond) // 再等几个 tick, 验证当天不重复
	if fs.count() != 1 {
		t.Errorf("同一天只应推送 1 次, got %d", fs.count())
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
}

// 未到点时不推送。
func TestRunDoesNotSendBeforeDueTime(t *testing.T) {
	st := newStore(t)
	fs := &fakeSender{}
	r := New(config.DigestConfig{Enabled: true, Time: "22:00"}, st, fs, nil)
	r.tick = 20 * time.Millisecond
	r.now = func() time.Time { return time.Date(2026, 9, 28, 21, 0, 0, 0, time.Local) }

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	r.Run(ctx)
	if fs.count() != 0 {
		t.Errorf("未到点不应推送, got %d", fs.count())
	}
}

func TestRunDisabledNeverPushes(t *testing.T) {
	st := newStore(t)
	fs := &fakeSender{}
	r := New(config.DigestConfig{Enabled: false, Time: "00:00"}, st, fs, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	r.Run(ctx)
	if fs.count() != 0 {
		t.Errorf("禁用时不应推送, got %d", fs.count())
	}
}

func TestUpdateTakesEffect(t *testing.T) {
	r := New(config.DigestConfig{Enabled: true, Time: "22:00"}, newStore(t), &fakeSender{}, nil)
	r.Update(config.DigestConfig{Enabled: false, Time: "07:30"})
	cfg := r.Config()
	if cfg.Enabled || cfg.Time != "07:30" {
		t.Errorf("Update 未生效: %+v", cfg)
	}
}

func TestFireSendsEmptyReportWhenNoEvents(t *testing.T) {
	st := newStore(t)
	fs := &fakeSender{}
	r := New(config.DigestConfig{Enabled: true, Time: "22:00"}, st, fs, func() string { return "前门" })
	r.Fire(time.Date(2026, 9, 28, 22, 0, 0, 0, time.Local))
	if fs.count() != 1 {
		t.Fatal("无事件也应推送日报")
	}
	if !strings.Contains(fs.last().Body, "今日无事发生") {
		t.Errorf("正文应为今日无事发生: %s", fs.last().Body)
	}
}
