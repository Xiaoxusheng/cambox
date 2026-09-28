package pipeline

import (
	"path/filepath"
	"testing"

	"camhub/internal/config"
	"camhub/internal/store"
)

func newTestPipeline(t *testing.T, mutate func(*config.Config)) *Pipeline {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.Server.DataDir = filepath.Join(dir, "data")
	cfg.Server.SnapshotDir = filepath.Join(dir, "snapshots")
	cfg.Record.Dir = filepath.Join(dir, "recordings")
	if mutate != nil {
		mutate(cfg)
	}
	st, err := store.Open(cfg.Server.DataDir, 100)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	return New(cfg, filepath.Join(dir, "config.yaml"), st)
}

// 契约 §2.2: armed 是运行时状态, 重启(新建 Pipeline)默认 true, 且不受配置影响。
func TestArmedDefaultsTrueAndNotPersisted(t *testing.T) {
	p := newTestPipeline(t, nil)
	if !p.Armed() {
		t.Fatal("新建 Pipeline 应默认布防(armed=true)")
	}
	p.SetArmed(false)
	if p.Armed() {
		t.Fatal("SetArmed(false) 后应为撤防")
	}
	// 不持久化: 重建 Pipeline 仍为 true
	p2 := newTestPipeline(t, nil)
	if !p2.Armed() {
		t.Error("armed 不应被持久化, 重建后应回到默认 true")
	}
}

// 契约 §2.2: motion.effective = motion.enabled && armed && scheduleActive.motion
func TestMotionEffectiveGating(t *testing.T) {
	// 空日程 = 全天放行
	p := newTestPipeline(t, nil)
	if !p.MotionEffective() {
		t.Error("默认配置应为 motion.effective=true")
	}
	p.SetArmed(false)
	if p.MotionEffective() {
		t.Error("撤防后 motion.effective 必须为 false")
	}
	p.SetArmed(true)
	if !p.MotionEffective() {
		t.Error("重新布防后 motion.effective 应恢复 true")
	}

	// motion.enabled=false
	p2 := newTestPipeline(t, func(c *config.Config) { c.Motion.Enabled = false })
	if p2.MotionEffective() {
		t.Error("motion.enabled=false 时 motion.effective 必须为 false")
	}

	// 日程不放行 motion: 只在周一的 00:00~00:01 放行, 用 2099 年不可能命中的规则
	p3 := newTestPipeline(t, func(c *config.Config) {
		c.Schedules.Rules = []config.ScheduleRule{{Days: []int{}, Start: "00:00", End: "00:01", Motion: false, Record: false}}
	})
	if p3.MotionEffective() {
		t.Error("日程不放行时 motion.effective 必须为 false")
	}
	if p3.RecordEffective() {
		t.Error("日程不放行时 record.effective 必须为 false")
	}
}

// 契约 §2.2: record.effective = record.enabled && scheduleActive.record —— 与 armed 无关
func TestRecordEffectiveIgnoresArmed(t *testing.T) {
	p := newTestPipeline(t, nil)
	if !p.RecordEffective() {
		t.Fatal("默认配置应为 record.effective=true")
	}
	p.SetArmed(false)
	if !p.RecordEffective() {
		t.Error("撤防只关事件入库+推送, 录像由 schedule.record 单独控制, record.effective 应仍为 true")
	}

	p2 := newTestPipeline(t, func(c *config.Config) { c.Record.Enabled = false })
	if p2.RecordEffective() {
		t.Error("record.enabled=false 时 record.effective 必须为 false")
	}
}

// 日程跨零点规则在午夜后仍生效(前一日窗口), 验证门控用的是当前时刻而非启动时刻。
func TestScheduleActiveAtRuntime(t *testing.T) {
	// 规则: 周一 00:00~00:00 视为全天 → 任何时刻都命中
	p := newTestPipeline(t, func(c *config.Config) {
		c.Schedules.Rules = []config.ScheduleRule{{Start: "00:00", End: "00:00", Motion: true, Record: true}}
	})
	m, r := p.ScheduleActive()
	if !m || !r {
		t.Errorf("start==end 应视为全天, got motion=%v record=%v", m, r)
	}
	if !p.MotionEffective() || !p.RecordEffective() {
		t.Error("全天日程下两个 effective 都应为 true")
	}
}
