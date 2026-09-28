// Package pipeline 装配 source/detector/recorder/清理器, 提供运行时设置与热更新。
// 设计见 docs/开发文档.md §4.6。
package pipeline

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"camhub/internal/config"
	"camhub/internal/detector"
	"camhub/internal/imgconv"
	"camhub/internal/notify"
	"camhub/internal/recorder"
	"camhub/internal/selfcheck"
	"camhub/internal/source"
	"camhub/internal/store"
)

// Pipeline 持有全部核心组件; Start 后台 goroutine 均随 ctx 取消退出。
type Pipeline struct {
	cfgPath string
	store   *store.Store
	src     *source.Source
	det     *detector.Motion
	rec     *recorder.Recorder
	nt      *notify.Notifier
	sc      *selfcheck.Checker

	mu       sync.RWMutex
	settings config.Config

	// armed 布防运行时状态(契约 §2.2): 不持久化, 重启默认 true。
	armed atomic.Bool

	startedAt   time.Time
	snapCounter atomic.Int64

	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func New(cfg *config.Config, cfgPath string, st *store.Store) *Pipeline {
	src := source.New(cfg.Camera)
	p := &Pipeline{
		cfgPath:  cfgPath,
		store:    st,
		src:      src,
		settings: *cfg,
		nt:       notify.New(cfg.Notify),
	}
	p.armed.Store(true) // 重启默认布防
	p.det = detector.New(cfg.Motion)
	p.rec = recorder.New(src, p.Settings, p.RecordEffective)
	p.sc = selfcheck.New(cfg.SelfCheck, src, p.onSelfCheckAlert)
	return p
}

// Notifier 供 HTTP 层执行「发送测试」。
func (p *Pipeline) Notifier() *notify.Notifier { return p.nt }

// SelfCheck 供 HTTP 层读取自检状态。
func (p *Pipeline) SelfCheck() *selfcheck.Checker { return p.sc }

// Settings 返回运行时配置副本。
func (p *Pipeline) Settings() config.Config {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.settings
}

// Armed 返回当前布防状态。
func (p *Pipeline) Armed() bool { return p.armed.Load() }

// SetArmed 切换布防状态(运行时, 不落盘)。
func (p *Pipeline) SetArmed(v bool) {
	if p.armed.Swap(v) == v {
		return
	}
	slog.Info("布防状态已切换", "armed", v)
}

// ScheduleActive 返回当前时刻日程是否放行移动侦测/录像(契约 §2.2)。
func (p *Pipeline) ScheduleActive() (motion, record bool) {
	return p.Settings().Schedules.ActiveAt(time.Now())
}

// MotionEffective 契约 §2.2: motion.enabled && armed && scheduleActive.motion。
func (p *Pipeline) MotionEffective() bool {
	motion, _ := p.ScheduleActive()
	return p.Settings().Motion.Enabled && p.Armed() && motion
}

// RecordEffective 契约 §2.2: record.enabled && scheduleActive.record。
func (p *Pipeline) RecordEffective() bool {
	_, record := p.ScheduleActive()
	return p.Settings().Record.Enabled && record
}

// Source 供 HTTP 层取帧(MJPEG/抓拍)。
func (p *Pipeline) Source() *source.Source { return p.src }

// Recorder 供 HTTP 层读取录像状态。
func (p *Pipeline) Recorder() *recorder.Recorder { return p.rec }

// StartedAt 服务启动时间。
func (p *Pipeline) StartedAt() time.Time { return p.startedAt }

// Start 启动全部后台 goroutine。
func (p *Pipeline) Start(ctx context.Context) {
	p.startedAt = time.Now()
	ctx, p.cancel = context.WithCancel(ctx)
	p.wg.Add(6)
	go func() { defer p.wg.Done(); p.src.Run(ctx) }()
	go func() { defer p.wg.Done(); p.detectLoop(ctx) }()
	go func() { defer p.wg.Done(); p.rec.Run(ctx) }()
	go func() { defer p.wg.Done(); p.cleanLoop(ctx) }()
	go func() { defer p.wg.Done(); p.nt.Run(ctx) }()
	go func() { defer p.wg.Done(); p.sc.Run(ctx) }()
	slog.Info("流水线已启动", "source", p.Settings().Camera.Type)
}

// Stop 取消并等待全部 goroutine 退出。
func (p *Pipeline) Stop() {
	p.cancel()
	p.wg.Wait()
	slog.Info("流水线已停止")
}

// UpdateSettings 热更新 motion/record: 钳制校验 → 原子落盘 → 替换运行时值。
func (p *Pipeline) UpdateSettings(motion config.MotionConfig, record config.RecordConfig) error {
	p.mu.Lock()
	next := p.settings
	next.Motion = motion
	next.Record = record
	next.Sanitize()
	if err := config.Save(p.cfgPath, &next); err != nil {
		p.mu.Unlock()
		return fmt.Errorf("保存配置: %w", err)
	}
	p.settings = next
	p.mu.Unlock()

	p.det.SetConfig(next.Motion)
	slog.Info("设置已更新", "motion.enabled", next.Motion.Enabled, "record.enabled", next.Record.Enabled)
	return nil
}

func (p *Pipeline) detectLoop(ctx context.Context) {
	cfg := p.Settings()
	eventsDir := filepath.Join(cfg.Server.SnapshotDir, "events")
	if err := os.MkdirAll(eventsDir, 0o755); err != nil {
		slog.Error("创建事件快照目录失败", "err", err)
	}

	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	frame := source.Frame{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !p.src.Snapshot(&frame) {
				continue
			}
			// 始终检测以保持基线新鲜; 事件是否入库由 motion.effective 决定(契约 §2.2):
			// motion.enabled && armed && scheduleActive.motion
			d, fired := p.det.Detect(&frame)
			if !fired {
				continue
			}
			if !p.MotionEffective() {
				continue
			}
			p.recordEvent(&frame, d, eventsDir)
		}
	}
}

var eventBoxColor = color.RGBA{R: 0x22, G: 0xc5, B: 0x5e, A: 0xff}

func (p *Pipeline) recordEvent(f *source.Frame, d detector.Detection, eventsDir string) {
	name := fmt.Sprintf("ev-%s-%03d.jpg", time.Now().Format("20060102-150405"), p.snapCounter.Add(1)%1000)
	path := filepath.Join(eventsDir, name)

	img := imgconv.ToRGBA(f)
	imgconv.DrawRect(img, d.Rect, eventBoxColor)
	if err := writeJPEG(path, img); err != nil {
		slog.Error("保存事件快照失败", "err", err)
		return
	}

	ev, err := p.store.Append("motion", d.Score, "/media/snapshots/events/"+name, "")
	if err != nil {
		slog.Error("事件入库失败", "err", err)
		return
	}
	slog.Info("侦测到移动", "id", ev.ID, "score", d.Score,
		"rect", fmt.Sprintf("(%d,%d)-(%d,%d)", d.Rect.Min.X, d.Rect.Min.Y, d.Rect.Max.X, d.Rect.Max.Y))

	p.notifyEvent(ev, path, "移动侦测")
}

// notifyEvent 事件推送(契约 §2: 撤防只关事件入库+推送)。
// 走 Notifier 异步队列, 不会阻塞侦测循环; 无启用通道时为空操作。
func (p *Pipeline) notifyEvent(ev store.Event, imagePath, kind string) {
	if len(p.nt.EnabledChannels(p.nt.Config())) == 0 {
		return
	}
	p.nt.Send(notify.Message{
		Title:     fmt.Sprintf("camhub %s", kind),
		Body:      p.eventBody(ev, kind),
		ImagePath: imagePath,
		ImageURL:  ev.Image,
		Link:      ev.Image,
	})
}

func (p *Pipeline) eventBody(ev store.Event, kind string) string {
	body := fmt.Sprintf("摄像头: %s\n类型: %s\n时间: %s\n事件 ID: %d",
		p.Settings().Camera.Name, kind, ev.Time.Format("2006-01-02 15:04:05"), ev.ID)
	if ev.Score > 0 {
		body += fmt.Sprintf("\n得分: %d", ev.Score)
	}
	if ev.Detail != "" {
		body += "\n详情: " + ev.Detail
	}
	return body
}

// onSelfCheckAlert 自检告警出口(契约 §2.4): 截图 + 事件入库 + 推送。
// 与移动侦测不同, 画面自检是设备健康检查, 不受 armed 影响(撤防时仍应告警)。
func (p *Pipeline) onSelfCheckAlert(alert string, f *source.Frame) {
	dir := filepath.Join(p.Settings().Server.SnapshotDir, "events")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slog.Error("创建事件快照目录失败", "err", err)
		return
	}
	name := fmt.Sprintf("sc-%s-%03d.jpg", time.Now().Format("20060102-150405"), p.snapCounter.Add(1)%1000)
	path := filepath.Join(dir, name)
	if err := writeJPEG(path, imgconv.ToRGBA(f)); err != nil {
		slog.Error("保存自检截图失败", "err", err)
		return
	}

	kind := "画面冻结"
	if alert == selfcheck.AlertOcclusion {
		kind = "画面异常"
	}
	ev, err := p.store.Append("selfcheck", 0, "/media/snapshots/events/"+name, alert)
	if err != nil {
		slog.Error("自检事件入库失败", "err", err)
		return
	}
	slog.Warn("画面自检告警", "id", ev.ID, "detail", alert, "snapshot", name)
	p.notifyEvent(ev, path, kind)
}

func (p *Pipeline) cleanLoop(ctx context.Context) {
	run := func() {
		cfg := p.Settings()
		n, err := recorder.CleanOnce(cfg, cfg.Server.SnapshotDir)
		if err != nil {
			slog.Warn("清理未完全完成", "removed", n, "err", err)
			return
		}
		if n > 0 {
			slog.Info("清理完成", "removed", n)
		}
	}
	run()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func writeJPEG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 85}); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
