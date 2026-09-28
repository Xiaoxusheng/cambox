package server

import (
	"bytes"
	"net/http"
	"sync"
)

// syncRecorder 是并发安全的 ResponseWriter。
//
// 为什么需要它：`httptest.ResponseRecorder` 的 Body/Header 没有任何同步，
// 而 SSE 处理器会在后台 goroutine 里持续 Write，测试同时在读 Body 做断言 ——
// `go test -race` 会直接报 bytes.Buffer 上的数据竞争（而且是测试自身的竞争，
// 不是被测代码的）。用带锁的 recorder 才能真正把 race 检测器用在 SSE 逻辑上。
type syncRecorder struct {
	mu     sync.Mutex
	buf    bytes.Buffer
	header http.Header
	code   int
	flushN int
}

func newSyncRecorder() *syncRecorder {
	return &syncRecorder{header: make(http.Header), code: http.StatusOK}
}

func (r *syncRecorder) Header() http.Header { return r.header }

func (r *syncRecorder) WriteHeader(code int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.code = code
}

func (r *syncRecorder) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.buf.Write(b)
}

// Flush 让处理器满足 http.Flusher（SSE 需要即时推送）。
func (r *syncRecorder) Flush() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.flushN++
}

// String 返回当前已写出的内容快照。
func (r *syncRecorder) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.buf.String()
}

// Code 返回 WriteHeader 记录的状态码。
func (r *syncRecorder) Code() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.code
}

// FlushCount 返回 Flush 调用次数。
func (r *syncRecorder) FlushCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.flushN
}
