// Package logbuf 提供日志环形缓冲: slog 输出同时进入内存(500 条)供 SSE 消费。
// 设计见 docs/contracts/api-v1.1.md §2.8 与 §3.3(GET /api/logs/stream)。
//
// 缓冲只保留最近 max 条; 订阅者只收到订阅之后的新日志(历史由调用方先回放 Snapshot)。
// 订阅者消费不及时时丢弃新日志而不阻塞日志写入路径。
package logbuf

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// DefaultMax 契约规定的缓冲条数。
const DefaultMax = 500

// Entry 一条日志, 字段与 SSE 输出一一对应。
type Entry struct {
	Time  time.Time `json:"time"`
	Level string    `json:"level"`
	Msg   string    `json:"msg"`
}

// Buffer 并发安全的定长环形缓冲 + 订阅广播。
type Buffer struct {
	mu      sync.Mutex
	entries []Entry
	max     int
	subs    map[int]chan Entry
	nextSub int
}

// New 创建缓冲; max<=0 时使用 DefaultMax。
func New(max int) *Buffer {
	if max <= 0 {
		max = DefaultMax
	}
	return &Buffer{max: max, subs: make(map[int]chan Entry)}
}

// Add 写入一条日志, 超出容量时丢弃最旧的一条。
func (b *Buffer) Add(e Entry) {
	if e.Time.IsZero() {
		e.Time = time.Now()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries = append(b.entries, e)
	if len(b.entries) > b.max {
		// 整体前移而不是切片重分配, 保持底层数组稳定
		copy(b.entries, b.entries[len(b.entries)-b.max:])
		b.entries = b.entries[:b.max]
	}
	for _, ch := range b.subs {
		select {
		case ch <- e:
		default:
			// 订阅者积压: 丢弃本条, 避免阻塞日志写入路径
		}
	}
}

// Snapshot 返回缓冲内全部日志的副本(时间升序)。
func (b *Buffer) Snapshot() []Entry {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]Entry, len(b.entries))
	copy(out, b.entries)
	return out
}

// Len 返回当前缓冲条数。
func (b *Buffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.entries)
}

// Subscribe 注册订阅者, 返回只读通道与取消函数(必须调用取消函数释放)。
func (b *Buffer) Subscribe() (<-chan Entry, func()) {
	ch := make(chan Entry, 64)
	b.mu.Lock()
	id := b.nextSub
	b.nextSub++
	b.subs[id] = ch
	b.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subs, id)
			b.mu.Unlock()
			close(ch)
		})
	}
	return ch, cancel
}

// Handler 包装底层 slog.Handler, 把每条日志同时写入环形缓冲。
type Handler struct {
	next  slog.Handler
	buf   *Buffer
	attrs []slog.Attr
}

// NewHandler 用 buf 包装 next。
func NewHandler(next slog.Handler, buf *Buffer) *Handler {
	return &Handler{next: next, buf: buf}
}

func (h *Handler) Enabled(ctx context.Context, lvl slog.Level) bool {
	return h.next.Enabled(ctx, lvl)
}

// Handle 先写缓冲再交给底层 Handler; 缓冲写入不会失败。
func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	h.buf.Add(Entry{
		Time:  r.Time,
		Level: levelString(r.Level),
		Msg:   formatMsg(h.attrs, r),
	})
	return h.next.Handle(ctx, r)
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	merged := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	merged = append(merged, h.attrs...)
	merged = append(merged, attrs...)
	return &Handler{next: h.next.WithAttrs(attrs), buf: h.buf, attrs: merged}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	return &Handler{next: h.next.WithGroup(name), buf: h.buf, attrs: h.attrs}
}

// formatMsg 把消息与属性拼成单行文本, 供面板直接展示。
func formatMsg(attrs []slog.Attr, r slog.Record) string {
	var sb strings.Builder
	sb.WriteString(r.Message)
	for _, a := range attrs {
		appendAttr(&sb, a)
	}
	r.Attrs(func(a slog.Attr) bool {
		appendAttr(&sb, a)
		return true
	})
	return sb.String()
}

func appendAttr(sb *strings.Builder, a slog.Attr) {
	v := a.Value.Resolve()
	if v.Kind() == slog.KindGroup {
		for _, sub := range v.Group() {
			appendAttr(sb, sub)
		}
		return
	}
	sb.WriteByte(' ')
	sb.WriteString(a.Key)
	sb.WriteByte('=')
	sb.WriteString(v.String())
}

// levelString 输出契约示例中的大写级别名(INFO/WARN/ERROR/DEBUG)。
func levelString(l slog.Level) string {
	switch {
	case l < slog.LevelInfo:
		return "DEBUG"
	case l < slog.LevelWarn:
		return "INFO"
	case l < slog.LevelError:
		return "WARN"
	default:
		return "ERROR"
	}
}
