package logbuf

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestRingKeepsLatest(t *testing.T) {
	b := New(3)
	for i := 0; i < 5; i++ {
		b.Add(Entry{Time: time.Now(), Level: "INFO", Msg: string(rune('a' + i))})
	}
	got := b.Snapshot()
	if len(got) != 3 {
		t.Fatalf("缓冲应保留 3 条, got %d", len(got))
	}
	if got[0].Msg != "c" || got[2].Msg != "e" {
		t.Errorf("应保留最新的 3 条, got %q..%q", got[0].Msg, got[2].Msg)
	}
	if b.Len() != 3 {
		t.Errorf("Len = %d, want 3", b.Len())
	}
}

func TestDefaultMaxIs500(t *testing.T) {
	b := New(0)
	for i := 0; i < 600; i++ {
		b.Add(Entry{Msg: "x"})
	}
	if b.Len() != DefaultMax {
		t.Errorf("默认上限应为 %d, got %d", DefaultMax, b.Len())
	}
}

func TestAddFillsZeroTime(t *testing.T) {
	b := New(1)
	b.Add(Entry{Msg: "x"})
	if b.Snapshot()[0].Time.IsZero() {
		t.Error("Time 为零值时应自动填充")
	}
}

func TestSubscribeReplayThenLive(t *testing.T) {
	b := New(10)
	b.Add(Entry{Msg: "old"}) // 订阅前的历史

	ch, cancel := b.Subscribe()
	defer cancel()
	b.Add(Entry{Msg: "new"})

	select {
	case e := <-ch:
		if e.Msg != "new" {
			t.Errorf("订阅者应只收到新日志, got %q", e.Msg)
		}
	case <-time.After(time.Second):
		t.Fatal("订阅者未收到新日志")
	}
	if got := b.Snapshot(); len(got) != 2 {
		t.Errorf("Snapshot 应含历史 2 条, got %d", len(got))
	}
}

func TestUnsubscribeClosesAndStops(t *testing.T) {
	b := New(10)
	ch, cancel := b.Subscribe()
	cancel()
	cancel() // 幂等
	if _, ok := <-ch; ok {
		t.Error("取消后通道应关闭")
	}
	b.Add(Entry{Msg: "after"}) // 不应 panic
	if b.Len() != 1 {
		t.Errorf("取消订阅后仍应正常写入, got %d", b.Len())
	}
}

func TestSlowSubscriberDoesNotBlock(t *testing.T) {
	b := New(10)
	_, cancel := b.Subscribe()
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 1000; i++ { // 远超订阅通道容量
			b.Add(Entry{Msg: "flood"})
		}
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("写入被慢订阅者阻塞")
	}
}

func TestHandlerWritesBufferAndDelegate(t *testing.T) {
	b := New(10)
	var out bytes.Buffer
	base := slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})
	logger := slog.New(NewHandler(base, b))

	logger.Info("服务已启动", "addr", "127.0.0.1:8788")
	logger.Warn("磁盘紧张", "pct", 91)
	logger.Debug("调试细节")

	got := b.Snapshot()
	if len(got) != 3 {
		t.Fatalf("缓冲应有 3 条, got %d", len(got))
	}
	if got[0].Level != "INFO" || got[1].Level != "WARN" || got[2].Level != "DEBUG" {
		t.Errorf("级别名不符契约示例: %q %q %q", got[0].Level, got[1].Level, got[2].Level)
	}
	if !strings.Contains(got[0].Msg, "服务已启动") || !strings.Contains(got[0].Msg, "addr=127.0.0.1:8788") {
		t.Errorf("消息应包含属性文本, got %q", got[0].Msg)
	}
	if !strings.Contains(out.String(), "服务已启动") {
		t.Error("底层 Handler 仍应收到日志")
	}

	// SSE 输出可直接 JSON 编码
	data, err := json.Marshal(got[0])
	if err != nil {
		t.Fatalf("Entry 应可 JSON 编码: %v", err)
	}
	for _, key := range []string{`"time":`, `"level":`, `"msg":`} {
		if !strings.Contains(string(data), key) {
			t.Errorf("SSE JSON 缺少 %s: %s", key, data)
		}
	}
}

func TestHandlerWithAttrsAndGroup(t *testing.T) {
	b := New(10)
	logger := slog.New(NewHandler(slog.NewTextHandler(&bytes.Buffer{}, nil), b).WithAttrs([]slog.Attr{
		slog.String("svc", "camhub"),
	}))

	logger.WithGroup("pipe").Info("流水线已启动", "n", 7)
	got := b.Snapshot()
	if len(got) != 1 {
		t.Fatalf("应有 1 条, got %d", len(got))
	}
	if !strings.Contains(got[0].Msg, "svc=camhub") || !strings.Contains(got[0].Msg, "n=7") {
		t.Errorf("WithAttrs 与分组属性都应进入文本, got %q", got[0].Msg)
	}
}

func TestHandlerEnabledFollowsDelegate(t *testing.T) {
	b := New(10)
	base := slog.NewTextHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: slog.LevelWarn})
	h := NewHandler(base, b)
	if h.Enabled(context.Background(), slog.LevelInfo) {
		t.Error("底层 Handler 禁用 INFO 时应透传 Enabled=false")
	}
}
