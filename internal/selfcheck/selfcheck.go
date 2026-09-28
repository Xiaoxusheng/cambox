// Package selfcheck 实现 C3 画面自检: 周期性取两帧比对, 判定画面冻结/被遮挡。
// 设计见 docs/contracts/api-v1.1.md §2.4 与 §3.2(selfcheck 状态)。
//
// 判定规则(契约 §2.4):
//   - 两帧 bitwise 完全相同 → frozen 计数 +1, 否则清零;
//   - 两帧降采样灰度平均差 > change_threshold → change 计数 +1, 否则清零;
//   - 任一计数达到 frozen_checks/change_checks → 触发告警(本项清零重新计数);
//   - 连续达标的语义由「计数达到阈值」体现, 单次异常不会误报。
//
// 告警后状态保持为告警类型, 直到下一次比对显示该异常已消失(画面恢复变化 / 变化幅度回落),
// 避免前端在计数清零后立刻看不到告警。
package selfcheck

import (
	"bytes"
	"context"
	"log/slog"
	"sync"
	"time"

	"camhub/internal/config"
	"camhub/internal/source"
)

// 自检状态与告警类型(契约 §3.2 / §3.4)。
const (
	StateOK        = "ok"
	StateFrozen    = "frozen"
	StateOcclusion = "occlusion"

	AlertFrozen    = "frozen"
	AlertOcclusion = "occlusion"
)

// frameGap 契约 §2.4 规定的两帧采样间隔。
const frameGap = 2 * time.Second

// loopTick 检查周期的轮询粒度; 实际自检间隔由 selfcheck.interval_sec 决定(支持热更新)。
const loopTick = time.Second

// diffDownscaleWidth 灰度差计算的降采样宽度。
const diffDownscaleWidth = 64

// FrameSource 取帧能力(由 *source.Source 实现; 测试可注入假实现)。
type FrameSource interface {
	Snapshot(out *source.Frame) bool
}

// State 自检状态快照, 字段与契约 §3.2 一一对应。
//
// LastAlert 记录「最近一次告警的类型」(frozen/occlusion), 未告警过为空串;
// State 是当前状态(ok/frozen/occlusion), 异常消失后回到 ok 而 LastAlert 保留。
type State struct {
	Enabled           bool       `json:"enabled"`
	LastRun           *time.Time `json:"last_run"`
	State             string     `json:"state"`
	LastAlert         string     `json:"last_alert"`
	ConsecutiveFrozen int        `json:"consecutive_frozen"`
	ConsecutiveChange int        `json:"consecutive_change"`
}

// Checker 自检执行器; Run 阻塞直到 ctx 取消。
type Checker struct {
	src     FrameSource
	onAlert func(alert string, f *source.Frame)
	gap     time.Duration
	now     func() time.Time

	mu    sync.Mutex
	cfg   config.SelfCheckConfig
	state State
}

// New 创建自检器。onAlert 在触发告警时被调用(入库+推送+截图), 可为 nil。
func New(cfg config.SelfCheckConfig, src FrameSource, onAlert func(string, *source.Frame)) *Checker {
	return &Checker{
		src:     src,
		onAlert: onAlert,
		gap:     frameGap,
		now:     time.Now,
		cfg:     cfg,
		state:   State{Enabled: cfg.Enabled, State: StateOK},
	}
}

// Update 热更新配置(契约 §2.7)。
func (c *Checker) Update(cfg config.SelfCheckConfig) {
	c.mu.Lock()
	c.cfg = cfg
	c.state.Enabled = cfg.Enabled
	c.mu.Unlock()
}

// Config 返回当前配置副本。
func (c *Checker) Config() config.SelfCheckConfig {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg
}

// State 返回状态快照(供 GET /api/status)。
func (c *Checker) State() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// Run 按 interval_sec 周期执行自检直到 ctx 取消。
func (c *Checker) Run(ctx context.Context) {
	ticker := time.NewTicker(loopTick)
	defer ticker.Stop()
	var lastRun time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cfg := c.Config()
			if !cfg.Enabled {
				lastRun = c.now() // 关闭期间不累计, 重新启用后从头计时
				continue
			}
			interval := time.Duration(cfg.IntervalSec) * time.Second
			if interval < time.Second {
				interval = time.Second
			}
			if c.now().Sub(lastRun) < interval {
				continue
			}
			lastRun = c.now()
			c.CheckOnce(ctx)
		}
	}
}

// CheckOnce 执行一次自检(取两帧 → 比对 → 计数 → 必要时告警)。
// 源不可用时直接返回且不计入任何计数, 避免断流被误判为画面冻结。
func (c *Checker) CheckOnce(ctx context.Context) {
	var a, b source.Frame
	if !c.src.Snapshot(&a) {
		return
	}
	if !sleepCtx(ctx, c.gap) {
		return
	}
	if !c.src.Snapshot(&b) {
		return
	}
	if a.W != b.W || a.H != b.H || len(a.Data) != len(b.Data) || len(a.Data) == 0 {
		return // 分辨率变化(源重启/切码流), 本轮跳过
	}

	identical := bytes.Equal(a.Data, b.Data)
	diff := AvgGrayDiff(&a, &b)

	cfg := c.Config()
	c.mu.Lock()
	st, alert := Evaluate(c.state, identical, diff, cfg, c.now())
	c.state = st
	c.mu.Unlock()

	slog.Debug("画面自检完成", "identical", identical, "avg_diff", diff, "state", st.State)
	if alert != "" && c.onAlert != nil {
		c.onAlert(alert, &b)
	}
}

// Evaluate 自检状态机(纯函数, 便于测试):
// 输入上一状态与本次比对结果, 返回新状态与本次触发的告警(空串=未告警)。
func Evaluate(prev State, identical bool, avgDiff int, cfg config.SelfCheckConfig, now time.Time) (State, string) {
	st := prev
	st.Enabled = cfg.Enabled
	st.LastRun = &now

	if identical {
		st.ConsecutiveFrozen++
	} else {
		st.ConsecutiveFrozen = 0
	}
	if avgDiff > cfg.ChangeThreshold {
		st.ConsecutiveChange++
	} else {
		st.ConsecutiveChange = 0
	}

	alert := ""
	switch {
	case st.ConsecutiveFrozen >= cfg.FrozenChecks:
		alert = AlertFrozen
		st.State = StateFrozen
		st.LastAlert = AlertFrozen
		st.ConsecutiveFrozen = 0 // 告警后本项清零重新计数
	case st.ConsecutiveChange >= cfg.ChangeChecks:
		alert = AlertOcclusion
		st.State = StateOcclusion
		st.LastAlert = AlertOcclusion
		st.ConsecutiveChange = 0
	case st.State == StateFrozen && !identical:
		st.State = StateOK // 画面重新有变化 → 冻结告警解除
	case st.State == StateOcclusion && avgDiff <= cfg.ChangeThreshold:
		st.State = StateOK // 变化幅度回落 → 遮挡告警解除
	}
	return st, alert
}

// AvgGrayDiff 两帧降采样灰度的平均绝对差(0~255), 用于契约 §2.4 的 change_threshold 比较。
// 尺寸或缓冲不一致时返回 0。
func AvgGrayDiff(a, b *source.Frame) int {
	if a.W != b.W || a.H != b.H || a.W <= 0 || a.H <= 0 {
		return 0
	}
	if len(a.Data) < a.W*a.H*3 || len(b.Data) < b.W*b.H*3 {
		return 0
	}
	dw := diffDownscaleWidth
	if dw > a.W {
		dw = a.W
	}
	dh := a.H * dw / a.W
	if dh < 1 {
		dh = 1
	}
	sum := 0
	for y := 0; y < dh; y++ {
		sy := y * a.H / dh
		row := sy * a.W
		for x := 0; x < dw; x++ {
			sx := x * a.W / dw
			i := (row + sx) * 3 // BGR24
			ga := gray(a.Data[i], a.Data[i+1], a.Data[i+2])
			gb := gray(b.Data[i], b.Data[i+1], b.Data[i+2])
			d := int(ga) - int(gb)
			if d < 0 {
				d = -d
			}
			sum += d
		}
	}
	return sum / (dw * dh)
}

func gray(b, g, r byte) int {
	return (299*int(r) + 587*int(g) + 114*int(b)) / 1000
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
