// Package recorder 按时长分段录像 + 保留策略清理。设计见 docs/开发文档.md §4.5。
// rtsp 源用第二条 ffmpeg 进程 -c copy 流复制; 其余源将共享帧编码为 libx264。
package recorder

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"camhub/internal/config"
	"camhub/internal/source"
)

// 录像模式。
const (
	ModeCopy   = "copy"
	ModeEncode = "encode"
)

var errSettingsChanged = errors.New("录像设置变更")

// errGateClosed 录像门控关闭(撤防/日程时段结束), 需停掉当前录像进程等待重新放行。
var errGateClosed = errors.New("录像门控关闭")

// segmentPattern ffmpeg strftime 文件名模式。
const segmentPattern = "%Y-%m-%d_%H-%M-%S.mp4"

// Status 录像状态快照。
type Status struct {
	Enabled     bool   `json:"enabled"`
	Running     bool   `json:"running"`
	Mode        string `json:"mode"`
	CurrentFile string `json:"current_file"`
	LastErr     string `json:"last_error,omitempty"`
}

// Recorder 管理录像进程生命周期; ctx 取消即停止。
type Recorder struct {
	src      *source.Source
	settings func() config.Config
	// gate 返回 record.effective(契约 §2.2: record.enabled && scheduleActive.record);
	// nil 表示只看 record.enabled。日程时段会随时间切换, 所以每次循环都要重新求值。
	gate func() bool

	mu      sync.Mutex
	running bool
	mode    string
	dir     string
	lastErr string
}

func New(src *source.Source, settings func() config.Config, gate func() bool) *Recorder {
	return &Recorder{src: src, settings: settings, gate: gate}
}

// allowed 当前是否允许录像。
func (r *Recorder) allowed() bool {
	return r.gate == nil || r.gate()
}

// Run 阻塞运行: enabled=false 或门控关闭时待机, 进程异常退出后指数退避重启。
func (r *Recorder) Run(ctx context.Context) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		cfg := r.settings()
		if !cfg.Record.Enabled || !r.allowed() {
			r.setState(false, "", cfg.Record.Dir, "")
			backoff = time.Second
			if !sleepCtx(ctx, 500*time.Millisecond) {
				return
			}
			continue
		}
		mode := recordMode(cfg)
		err := r.runOnce(ctx, cfg, mode)
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, errSettingsChanged) {
			backoff = time.Second
			slog.Info("录像设置变更, 重启录像进程")
			continue
		}
		if errors.Is(err, errGateClosed) {
			backoff = time.Second
			slog.Info("录像门控关闭(撤防或不在录像时段), 暂停录像")
			continue
		}
		if err != nil {
			r.setState(false, mode, cfg.Record.Dir, err.Error())
			slog.Warn("录像进程退出", "err", err)
		}
		if !sleepCtx(ctx, backoff) {
			return
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// runOnce 启动一次录像进程, 阻塞至进程退出 / ctx 取消 / 设置变更。
func (r *Recorder) runOnce(ctx context.Context, cfg config.Config, mode string) error {
	if err := os.MkdirAll(cfg.Record.Dir, 0o755); err != nil {
		return fmt.Errorf("创建录像目录: %w", err)
	}
	pctx, cancel := context.WithCancel(ctx)
	defer cancel()

	cmd := exec.CommandContext(pctx, "ffmpeg", recordArgs(cfg, mode)...)
	var stdin io.WriteCloser
	if mode == ModeEncode {
		p, err := cmd.StdinPipe()
		if err != nil {
			return fmt.Errorf("创建 stdin 管道: %w", err)
		}
		stdin = p
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 ffmpeg 录像: %w", err)
	}
	r.setState(true, mode, cfg.Record.Dir, "")

	procDone := make(chan error, 1)
	go func() { procDone <- cmd.Wait() }()

	writeDone := make(chan error, 1)
	if stdin != nil {
		go func() { writeDone <- writeFrames(pctx, r.src, stdin, cfg) }()
	}

	var stop reason
	watch := time.NewTicker(time.Second)
	defer watch.Stop()
loop:
	for {
		select {
		case <-ctx.Done():
			stop = reason{err: ctx.Err()}
		case err := <-procDone:
			stop = reason{err: err, fromProcess: true}
		case <-writeDone:
			stop = reason{err: errors.New("帧写入中断")}
		case <-watch.C:
			if !sameRecordSettings(r.settings(), cfg) {
				stop = reason{err: errSettingsChanged}
			} else if !r.allowed() {
				stop = reason{err: errGateClosed}
			}
		}
		if stop.err != nil {
			break loop
		}
	}

	cancel() // 杀进程(CommandContext 绑定 pctx)
	if stdin != nil {
		stdin.Close()
	}
	procErr := <-procDone
	_ = writeDone // 写出协程随进程退出自然结束(缓冲通道, 不会泄漏)

	switch {
	case errors.Is(stop.err, errSettingsChanged), errors.Is(stop.err, errGateClosed):
		return stop.err
	case stop.fromProcess && procErr != nil && ctx.Err() == nil:
		return fmt.Errorf("ffmpeg 录像: %w", procErr)
	case ctx.Err() != nil:
		return ctx.Err()
	default:
		return stop.err
	}
}

// reason 区分退出来源, 避免把正常关闭当故障。
type reason struct {
	err         error
	fromProcess bool
}

// writeFrames 按目标帧率从帧槽取帧写入 ffmpeg stdin。
func writeFrames(ctx context.Context, src *source.Source, w io.Writer, cfg config.Config) error {
	interval := time.Second / time.Duration(cfg.Camera.FPS)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	frame := source.Frame{}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !src.Snapshot(&frame) {
				continue // 源未就绪, 跳过
			}
			if _, err := w.Write(frame.Data); err != nil {
				return err
			}
		}
	}
}

// Status 状态快照; CurrentFile 为录像目录中最新的分段文件。
func (r *Recorder) Status() Status {
	r.mu.Lock()
	st := Status{Running: r.running, Mode: r.mode, LastErr: r.lastErr}
	dir := r.dir
	r.mu.Unlock()
	st.Enabled = r.settings().Record.Enabled
	st.CurrentFile = newestFile(dir, ".mp4")
	return st
}

func (r *Recorder) setState(running bool, mode, dir, lastErr string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.running = running
	r.mode = mode
	r.dir = dir
	r.lastErr = lastErr
}

// newestFile 返回目录中最新修改的指定后缀文件名(无则空串)。
func newestFile(dir, ext string) string {
	if dir == "" {
		return ""
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	bestName, bestMod := "", time.Time{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ext) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(bestMod) {
			bestName, bestMod = e.Name(), info.ModTime()
		}
	}
	return bestName
}

// CleanOnce 保留策略: 先删过期文件(录像+事件快照), 再按容量上限从最旧删录像。
// 返回删除文件数。
func CleanOnce(cfg config.Config, snapshotDir string) (int, error) {
	removed := 0
	cutoff := time.Now().AddDate(0, 0, -cfg.Record.RetentionDays)
	dirs := []string{
		cfg.Record.Dir,
		filepath.Join(snapshotDir, "events"),
		filepath.Join(snapshotDir, "manual"),
	}
	for _, dir := range dirs {
		n, err := removeOlderThan(dir, cutoff)
		removed += n
		if err != nil {
			return removed, err
		}
	}

	maxBytes := int64(cfg.Record.MaxDiskGB * (1 << 30))
	for {
		files, total, err := listFiles(cfg.Record.Dir)
		if err != nil || len(files) == 0 || total <= maxBytes {
			return removed, err
		}
		if err := os.Remove(filepath.Join(cfg.Record.Dir, files[0].name)); err != nil {
			return removed, err
		}
		removed++
		total -= files[0].size
	}
}

func removeOlderThan(dir string, cutoff time.Time) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	removed := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
				removed++
			}
		}
	}
	return removed, nil
}

type fileInfo struct {
	name string
	size int64
	mod  time.Time
}

func listFiles(dir string) ([]fileInfo, int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, nil
		}
		return nil, 0, err
	}
	var files []fileInfo
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, fileInfo{name: e.Name(), size: info.Size(), mod: info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
	return files, total, nil
}

// recordMode 决定录像走流复制还是重新编码。
//
// v1.2: url 源(网络流, 如直播拉流)与 rtsp 一样走 `-c copy`, 保留原始码流画质且零转码 CPU。
// 只有合成/文件/采集卡这类"只能拿到共享帧"的源才需要重新编码成 H.264。
// 抽成函数是为了让这层判定可被单测覆盖 —— 它决定了用户最终看到的是原画质还是二次压缩。
func recordMode(cfg config.Config) string {
	switch cfg.Camera.Type {
	case config.TypeRTSP, config.TypeURL:
		return ModeCopy
	default:
		return ModeEncode
	}
}

// recordArgs 构造录像 ffmpeg 命令(按时长分段)。
func recordArgs(cfg config.Config, mode string) []string {
	pattern := filepath.Join(cfg.Record.Dir, segmentPattern)
	base := []string{"-hide_banner", "-loglevel", "warning"}
	var in, codec []string
	if mode == ModeCopy {
		if cfg.Camera.Type == config.TypeURL {
			// 网络流: 不能用 -rtsp_transport(那是 RTSP 专用的), http(s) 用 reconnect 提高抗断流能力。
			in = []string{"-rw_timeout", "8000000"}
			if strings.HasPrefix(cfg.Camera.URL, "http://") || strings.HasPrefix(cfg.Camera.URL, "https://") {
				in = append(in, "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10")
			}
			in = append(in, "-i", cfg.Camera.URL, "-map", "0")
		} else {
			in = []string{"-rtsp_transport", "tcp", "-i", cfg.Camera.RTSP, "-map", "0"}
		}
		codec = []string{"-c", "copy"}
	} else {
		in = []string{
			"-f", "rawvideo", "-pixel_format", "bgr24",
			"-video_size", fmt.Sprintf("%dx%d", cfg.Camera.Width, cfg.Camera.Height),
			"-framerate", fmt.Sprint(cfg.Camera.FPS), "-i", "pipe:0",
		}
		// v1.2: CRF 可配(record.encode_crf), 越小越清晰越大。
		codec = []string{"-c:v", "libx264", "-preset", "veryfast",
			"-crf", fmt.Sprint(cfg.Record.EncodeCRF), "-pix_fmt", "yuv420p"}
	}
	tail := []string{
		"-f", "segment",
		"-segment_time", fmt.Sprint(cfg.Record.SegmentSeconds),
		"-reset_timestamps", "1", "-strftime", "1", pattern,
	}
	return append(append(append(base, in...), codec...), tail...)
}

// sameRecordSettings 判断影响录像进程的设置是否变化。
func sameRecordSettings(a, b config.Config) bool {
	return a.Record.Enabled == b.Record.Enabled &&
		a.Record.Dir == b.Record.Dir &&
		a.Record.SegmentSeconds == b.Record.SegmentSeconds &&
		a.Camera.Type == b.Camera.Type &&
		a.Camera.RTSP == b.Camera.RTSP &&
		a.Camera.Width == b.Camera.Width &&
		a.Camera.Height == b.Camera.Height &&
		a.Camera.FPS == b.Camera.FPS
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
