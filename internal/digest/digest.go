// Package digest 实现 C9 每日日报: 每天到点统计过去 24h 事件并走 notify 推送。
// 设计见 docs/contracts/api-v1.1.md §2.5。
//
// 调度语义: 当前时刻已过 digest.time 且当天尚未推送过 → 推送一次(日期为幂等键)。
// 因此服务在推送时刻之后启动会补发一次当天的日报, 这是有意行为(停机不丢日报)。
package digest

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"camhub/internal/config"
	"camhub/internal/notify"
	"camhub/internal/store"
)

// checkTick 调度轮询粒度(日报只需分钟级精度)。
const checkTick = 30 * time.Second

// Sender 推送出口; *notify.Notifier 实现该接口, 测试可注入假实现。
type Sender interface {
	Send(msg notify.Message)
}

// Reporter 日报调度器; Run 阻塞直到 ctx 取消。
type Reporter struct {
	store      *store.Store
	sender     Sender
	cameraName func() string
	now        func() time.Time
	tick       time.Duration

	mu        sync.Mutex
	cfg       config.DigestConfig
	lastFired string // 已推送的日期 YYYY-MM-DD(内存幂等键, 重启后允许补发)
}

// New 创建日报调度器。cameraName 为 nil 时正文不显示摄像头名。
func New(cfg config.DigestConfig, st *store.Store, sender Sender, cameraName func() string) *Reporter {
	if cameraName == nil {
		cameraName = func() string { return "" }
	}
	return &Reporter{store: st, sender: sender, cameraName: cameraName, now: time.Now, tick: checkTick, cfg: cfg}
}

// Update 热更新配置(契约 §2.7)。
func (r *Reporter) Update(cfg config.DigestConfig) {
	r.mu.Lock()
	r.cfg = cfg
	r.mu.Unlock()
}

// Config 返回当前配置副本。
func (r *Reporter) Config() config.DigestConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg
}

// Run 周期检查是否到点, 直到 ctx 取消。
func (r *Reporter) Run(ctx context.Context) {
	ticker := time.NewTicker(r.tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cfg := r.Config()
			now := r.now()
			if !cfg.Enabled || !DueTime(cfg, now) {
				continue
			}
			r.Fire(now)
		}
	}
}

// Fire 推送指定时刻的日报; 当天已推送过则跳过并返回 false。
// now 之前的 24 小时为统计区间。
func (r *Reporter) Fire(now time.Time) bool {
	key := now.Format("2006-01-02")
	r.mu.Lock()
	if r.lastFired == key {
		r.mu.Unlock()
		return false
	}
	r.lastFired = key
	r.mu.Unlock()

	from := now.Add(-24 * time.Hour)
	total, hourly, top := r.store.DayStats(from, now)
	title, body := BuildReport(key, from, now, total, hourly, top, r.cameraName())
	r.sender.Send(notify.Message{Title: title, Body: body})
	slog.Info("每日日报已推送", "date", key, "total", total, "window_from", from.Format(time.RFC3339))
	return true
}

// DueTime 判断 now 是否已过当天的推送时刻(纯函数, 不关心是否已推送)。
func DueTime(cfg config.DigestConfig, now time.Time) bool {
	minutes, ok := config.ParseHHMM(cfg.Time)
	if !ok {
		return false
	}
	target := time.Date(now.Year(), now.Month(), now.Day(), minutes/60, minutes%60, 0, 0, now.Location())
	return !now.Before(target)
}

// BuildReport 生成日报标题与正文(纯函数, 便于测试)。
// 无事件时正文为「今日无事发生」(契约 §2.5)。
func BuildReport(date string, from, to time.Time, total int, hourly [24]int, top *store.Event, cameraName string) (title, body string) {
	title = "camhub 日报 " + date

	var sb strings.Builder
	if cameraName != "" {
		fmt.Fprintf(&sb, "摄像头: %s\n", cameraName)
	}
	fmt.Fprintf(&sb, "统计区间: %s ~ %s\n",
		from.Format("2006-01-02 15:04"), to.Format("2006-01-02 15:04"))

	if total == 0 {
		sb.WriteString("今日无事发生")
		return title, sb.String()
	}

	fmt.Fprintf(&sb, "事件总数: %d\n", total)
	sb.WriteString("按小时分布:\n")
	for h := 0; h < 24; h++ {
		if hourly[h] > 0 {
			fmt.Fprintf(&sb, "  %02d 时 %d 条\n", h, hourly[h])
		}
	}
	if top != nil {
		fmt.Fprintf(&sb, "最高分事件: #%d %s 类型 %s 得分 %d",
			top.ID, top.Time.Format("2006-01-02 15:04:05"), top.Type, top.Score)
		if top.Detail != "" {
			fmt.Fprintf(&sb, " (%s)", top.Detail)
		}
	}
	return title, sb.String()
}
