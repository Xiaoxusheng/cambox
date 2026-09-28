// Package source 通过 FFmpeg 子进程将各类视频源解码为统一 BGR24 裸帧。
// 设计见 docs/开发文档.md §4.3。ctx 取消时 FFmpeg 进程随之被杀死。
package source

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"camhub/internal/config"
)

// Frame 一帧 BGR24 裸帧, Data 长度恒为 W*H*3。
type Frame struct {
	W, H int
	Data []byte
}

// Stats 取流快照状态。
type Stats struct {
	Connected bool
	FPS       float64
	Width     int
	Height    int
	Restarts  int64
	LastError string
	Log       []string
}

// logRing 保留最近 max 条 stderr 行, 用于排查 RTSP 问题。
type logRing struct {
	mu    sync.Mutex
	lines []string
	max   int
}

func (r *logRing) Add(s string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines = append(r.lines, s)
	if len(r.lines) > r.max {
		r.lines = r.lines[len(r.lines)-r.max:]
	}
}

func (r *logRing) Snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.lines))
	copy(out, r.lines)
	return out
}

// Source 单写多读的取流器: run 循环持有 ffmpeg 解码进程, 帧经写锁写入槽位。
type Source struct {
	cfg config.CameraConfig
	log logRing

	mu        sync.Mutex
	frame     []byte // 槽位缓冲
	w, h      int
	frameSeq  uint64
	ts        []time.Time // 最近帧时间戳, 用于估算 fps
	connected bool
	restarts  int64
	lastErr   string
}

func New(cfg config.CameraConfig) *Source {
	return &Source{cfg: cfg, w: cfg.Width, h: cfg.Height}
}

// Run 阻塞运行直到 ctx 取消。断线自动重连, 进程异常退出按固定间隔重启。
func (s *Source) Run(ctx context.Context) {
	delay := time.Duration(s.cfg.ReconnectDelay) * time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		pctx, cancel := context.WithCancel(ctx)
		err := s.runOnce(pctx, s.frameSize())
		cancel() // 杀死 ffmpeg(CommandContext 绑定 pctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			s.markDisconnected(err)
		} else {
			s.markDisconnected(errors.New("流结束"))
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func (s *Source) frameSize() int {
	return s.cfg.Width * s.cfg.Height * 3
}

func (s *Source) runOnce(ctx context.Context, frameSize int) error {
	cmd := exec.CommandContext(ctx, "ffmpeg", decodeArgs(s.cfg)...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("创建 stdout 管道: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("创建 stderr 管道: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 ffmpeg: %w", err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			s.log.Add(sc.Text())
		}
	}()

	readErr := s.readLoop(stdout, frameSize)
	<-done // stderr 排干, 避免管道缓冲阻塞
	cmd.Wait()
	return readErr
}

func (s *Source) readLoop(r io.Reader, frameSize int) error {
	buf := make([]byte, frameSize)
	for {
		if _, err := io.ReadFull(r, buf); err != nil {
			return err
		}
		s.publish(buf)
	}
}

// publish 写锁内 memcpy 进槽位; 读者通过 Snapshot 拷出。
func (s *Source) publish(buf []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.frame) != len(buf) {
		s.frame = make([]byte, len(buf))
	}
	copy(s.frame, buf)
	s.frameSeq++
	now := time.Now()
	s.ts = append(s.ts, now)
	if len(s.ts) > 64 {
		s.ts = s.ts[len(s.ts)-64:]
	}
	s.connected = true
}

func (s *Source) markDisconnected(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = false
	s.restarts++
	s.lastErr = err.Error()
	s.ts = s.ts[:0]
	s.log.Add("[source] 连接断开: " + err.Error())
}

// Snapshot 将当前帧拷入 out(缓冲按需增长), 无可用帧时返回 false。
func (s *Source) Snapshot(out *Frame) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.connected || len(s.frame) == 0 {
		return false
	}
	if cap(out.Data) < len(s.frame) {
		out.Data = make([]byte, len(s.frame))
	}
	out.Data = out.Data[:len(s.frame)]
	copy(out.Data, s.frame)
	out.W, out.H = s.w, s.h
	return true
}

// Stats 返回取流状态快照。
func (s *Source) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Stats{
		Connected: s.connected,
		Width:     s.w,
		Height:    s.h,
		Restarts:  s.restarts,
		LastError: s.lastErr,
		Log:       s.log.Snapshot(),
	}
	if n := len(s.ts); n >= 2 {
		elapsed := s.ts[n-1].Sub(s.ts[0]).Seconds()
		if elapsed > 0 {
			st.FPS = float64(n-1) / elapsed
		}
	}
	return st
}

// decodeArgs 按来源类型构造 ffmpeg 解码命令(输出 BGR24 到 stdout)。
// 解码源: type=rtsp 时优先用子码流 sub_rtsp(空则回退主码流);
// 统一加 -vf scale=W:H 强制输出 cfg.Width×cfg.Height, 保证子码流分辨率与帧槽一致。
func decodeArgs(cfg config.CameraConfig) []string {
	base := []string{"-hide_banner", "-loglevel", "warning"}
	var in []string
	switch cfg.Type {
	case config.TypeRTSP:
		url := cfg.RTSP
		if cfg.SubRTSP != "" {
			url = cfg.SubRTSP
		}
		in = []string{"-rtsp_transport", "tcp", "-rw_timeout", "8000000", "-i", url}
	case config.TypeFile:
		in = []string{"-re", "-i", cfg.File}
	case config.TypeDShow:
		in = []string{"-f", "dshow", "-i", "video=" + cfg.DShowDevice}
	default: // synthetic
		in = []string{"-re", "-f", "lavfi", "-i", fmt.Sprintf("testsrc2=size=%dx%d:rate=%d", cfg.Width, cfg.Height, cfg.FPS)}
	}
	out := []string{
		"-vf", fmt.Sprintf("scale=%d:%d", cfg.Width, cfg.Height),
		"-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
	}
	return append(append(base, in...), out...)
}
