package selfcheck

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"camhub/internal/config"
	"camhub/internal/source"
)

func mkFrame(w, h int, b, g, r byte) *source.Frame {
	f := &source.Frame{W: w, H: h, Data: make([]byte, w*h*3)}
	for i := 0; i < len(f.Data); i += 3 {
		f.Data[i], f.Data[i+1], f.Data[i+2] = b, g, r
	}
	return f
}

func defaultCfg() config.SelfCheckConfig {
	return config.SelfCheckConfig{
		Enabled:         true,
		IntervalSec:     300,
		FrozenChecks:    3,
		ChangeThreshold: 25,
		ChangeChecks:    3,
	}
}

// ---- 状态机 ----

func TestEvaluateFrozenRequiresConsecutive(t *testing.T) {
	cfg := defaultCfg()
	st := State{State: StateOK}
	now := time.Unix(1790000000, 0)

	// 前两次相同: 只计数, 不告警
	for i := 1; i <= 2; i++ {
		var alert string
		st, alert = Evaluate(st, true, 0, cfg, now)
		if alert != "" {
			t.Fatalf("第 %d 次不应告警", i)
		}
		if st.ConsecutiveFrozen != i {
			t.Fatalf("ConsecutiveFrozen = %d, want %d", st.ConsecutiveFrozen, i)
		}
		if st.State != StateOK {
			t.Fatalf("未告警时 state 应为 ok, got %q", st.State)
		}
	}
	// 第三次达标 → 告警 + 本项清零
	st, alert := Evaluate(st, true, 0, cfg, now)
	if alert != AlertFrozen {
		t.Fatalf("第 3 次应告警 frozen, got %q", alert)
	}
	if st.State != StateFrozen || st.LastAlert != AlertFrozen {
		t.Errorf("告警后 state/last_alert 应为 frozen: %+v", st)
	}
	if st.ConsecutiveFrozen != 0 {
		t.Errorf("告警后本项应清零, got %d", st.ConsecutiveFrozen)
	}
	if st.LastRun == nil || !st.LastRun.Equal(now) {
		t.Errorf("LastRun 应为本次时刻: %v", st.LastRun)
	}
}

func TestEvaluateFrozenCounterResetsOnChange(t *testing.T) {
	cfg := defaultCfg()
	st := State{State: StateOK}
	now := time.Now()

	st, _ = Evaluate(st, true, 0, cfg, now)
	st, _ = Evaluate(st, true, 0, cfg, now)
	st, _ = Evaluate(st, false, 0, cfg, now) // 画面有变化 → 清零
	if st.ConsecutiveFrozen != 0 {
		t.Fatalf("画面变化后 frozen 计数应清零, got %d", st.ConsecutiveFrozen)
	}
	// 再连续 2 次仍不足 3
	st, _ = Evaluate(st, true, 0, cfg, now)
	st, alert := Evaluate(st, true, 0, cfg, now)
	if alert != "" {
		t.Errorf("清零后重新计数, 2 次不应告警, got %q", alert)
	}
}

func TestEvaluateOcclusionOnGrayChange(t *testing.T) {
	cfg := defaultCfg()
	st := State{State: StateOK}
	now := time.Now()

	// 平均差 = 阈值 不算达标(严格大于)
	st, alert := Evaluate(st, false, cfg.ChangeThreshold, cfg, now)
	if alert != "" || st.ConsecutiveChange != 0 {
		t.Fatalf("avgDiff == threshold 不应计数: %+v", st)
	}

	for i := 1; i <= 2; i++ {
		st, alert = Evaluate(st, false, 200, cfg, now)
		if alert != "" {
			t.Fatalf("第 %d 次不应告警", i)
		}
	}
	st, alert = Evaluate(st, false, 200, cfg, now)
	if alert != AlertOcclusion {
		t.Fatalf("第 3 次应告警 occlusion, got %q", alert)
	}
	if st.State != StateOcclusion || st.LastAlert != AlertOcclusion || st.ConsecutiveChange != 0 {
		t.Errorf("遮挡告警状态错误: %+v", st)
	}
}

func TestEvaluateOcclusionCounterResetsOnCalm(t *testing.T) {
	cfg := defaultCfg()
	st := State{State: StateOK}
	now := time.Now()
	st, _ = Evaluate(st, false, 200, cfg, now)
	st, _ = Evaluate(st, false, 200, cfg, now)
	st, _ = Evaluate(st, false, 5, cfg, now) // 画面平静 → 清零
	if st.ConsecutiveChange != 0 {
		t.Fatalf("画面平静后 change 计数应清零, got %d", st.ConsecutiveChange)
	}
}

// 告警解除: 冻结告警在画面重新变化时回到 ok, 但 last_alert 保留。
func TestEvaluateStateClearsAfterRecovery(t *testing.T) {
	cfg := defaultCfg()
	st := State{State: StateFrozen, LastAlert: AlertFrozen}
	now := time.Now()
	st, alert := Evaluate(st, false, 0, cfg, now)
	if alert != "" {
		t.Errorf("恢复时不应再告警: %q", alert)
	}
	if st.State != StateOK {
		t.Errorf("画面重新变化后 state 应回到 ok, got %q", st.State)
	}
	if st.LastAlert != AlertFrozen {
		t.Errorf("last_alert 应保留最近一次告警类型, got %q", st.LastAlert)
	}

	st2 := State{State: StateOcclusion, LastAlert: AlertOcclusion}
	st2, _ = Evaluate(st2, false, 3, cfg, now)
	if st2.State != StateOK {
		t.Errorf("变化幅度回落后 state 应回到 ok, got %q", st2.State)
	}
}

// 冻结告警后画面仍静止时, 状态应保持 frozen 不闪回 ok(计数已清零但异常仍在)。
func TestEvaluateNoFlickerAfterAlert(t *testing.T) {
	cfg := defaultCfg()
	st := State{State: StateOK}
	now := time.Now()
	for i := 0; i < 3; i++ {
		st, _ = Evaluate(st, true, 0, cfg, now)
	}
	if st.State != StateFrozen {
		t.Fatal("应处于 frozen")
	}
	st, alert := Evaluate(st, true, 0, cfg, now)
	if st.State != StateFrozen || alert != "" {
		t.Errorf("异常仍在时状态应保持 frozen 且不重复告警: state=%q alert=%q", st.State, alert)
	}
}

func TestEvaluateJSONShape(t *testing.T) {
	data, err := json.Marshal(State{State: StateOK})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		`"enabled":`, `"last_run":`, `"state":`, `"last_alert":`,
		`"consecutive_frozen":`, `"consecutive_change":`,
	} {
		if !strings.Contains(string(data), key) {
			t.Errorf("状态 JSON 缺少 %s: %s", key, data)
		}
	}
	if !strings.Contains(string(data), `"last_alert":""`) {
		t.Errorf("未告警时 last_alert 应为空串(契约 §3.2): %s", data)
	}
}

// ---- 灰度差 ----

func TestAvgGrayDiff(t *testing.T) {
	black := mkFrame(64, 48, 0, 0, 0)
	white := mkFrame(64, 48, 255, 255, 255)
	if d := AvgGrayDiff(black, white); d < 254 || d > 255 {
		t.Errorf("黑/白平均差应约 255, got %d", d)
	}
	if d := AvgGrayDiff(black, black); d != 0 {
		t.Errorf("同帧平均差应为 0, got %d", d)
	}

	// 一半白一半黑
	half := mkFrame(64, 48, 0, 0, 0)
	for y := 0; y < 24; y++ {
		for x := 0; x < 64; x++ {
			i := (y*64 + x) * 3
			half.Data[i], half.Data[i+1], half.Data[i+2] = 255, 255, 255
		}
	}
	if d := AvgGrayDiff(black, half); d < 120 || d > 135 {
		t.Errorf("半屏变化平均差应约 127, got %d", d)
	}
}

func TestAvgGrayDiffGuards(t *testing.T) {
	a := mkFrame(64, 48, 10, 10, 10)
	b := mkFrame(32, 24, 10, 10, 10)
	if d := AvgGrayDiff(a, b); d != 0 {
		t.Errorf("尺寸不一致应返回 0, got %d", d)
	}
	if d := AvgGrayDiff(&source.Frame{W: 0, H: 0}, &source.Frame{W: 0, H: 0}); d != 0 {
		t.Errorf("空帧应返回 0, got %d", d)
	}
	short := &source.Frame{W: 64, H: 48, Data: []byte{1, 2, 3}}
	if d := AvgGrayDiff(short, a); d != 0 {
		t.Errorf("缓冲不足应返回 0, got %d", d)
	}
}

// ---- Checker ----

type fakeSource struct {
	mu     sync.Mutex
	frames []*source.Frame
	i      int
	fail   bool
}

func (f *fakeSource) Snapshot(out *source.Frame) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail || f.i >= len(f.frames) {
		return false
	}
	fr := f.frames[f.i]
	f.i++
	*out = source.Frame{W: fr.W, H: fr.H, Data: append([]byte(nil), fr.Data...)}
	return true
}

func newChecker(t *testing.T, frames []*source.Frame, alerts *[]string) *Checker {
	t.Helper()
	c := New(defaultCfg(), &fakeSource{frames: frames}, func(alert string, _ *source.Frame) {
		*alerts = append(*alerts, alert)
	})
	c.gap = time.Millisecond
	return c
}

func TestCheckOnceTriggersFrozenAfterThreshold(t *testing.T) {
	same := mkFrame(64, 48, 0, 0, 0)
	var alerts []string
	c := newChecker(t, []*source.Frame{same, same, same, same, same, same}, &alerts)

	// 每轮消耗 2 帧; 第 3 轮达标告警
	for i := 0; i < 3; i++ {
		c.CheckOnce(context.Background())
	}
	if len(alerts) != 1 || alerts[0] != AlertFrozen {
		t.Fatalf("第 3 轮应触发 frozen, got %v", alerts)
	}
	if st := c.State(); st.State != StateFrozen || st.LastRun == nil {
		t.Errorf("状态错误: %+v", st)
	}
}

func TestCheckOnceNoAlertWhenFramesDiffer(t *testing.T) {
	a := mkFrame(64, 48, 0, 0, 0)
	b := mkFrame(64, 48, 0, 0, 0)
	b.Data[0] = 9 // 轻微差异: 不算完全相同, 灰度差也很小
	var alerts []string
	c := newChecker(t, []*source.Frame{a, b, a, b, a, b, a, b}, &alerts)

	for i := 0; i < 4; i++ {
		c.CheckOnce(context.Background())
	}
	if len(alerts) != 0 {
		t.Fatalf("画面有变化且幅度小, 不应告警: %v", alerts)
	}
	if st := c.State(); st.State != StateOK {
		t.Errorf("state 应为 ok, got %q", st.State)
	}
}

func TestCheckOnceSkipsWhenSourceUnavailable(t *testing.T) {
	var alerts []string
	c := New(defaultCfg(), &fakeSource{fail: true}, func(a string, _ *source.Frame) { alerts = append(alerts, a) })
	c.gap = time.Millisecond
	c.CheckOnce(context.Background())
	if st := c.State(); st.LastRun != nil {
		t.Error("源不可用时不应更新 last_run(避免断流被误判为冻结)")
	}
	if len(alerts) != 0 {
		t.Errorf("源不可用时不应告警: %v", alerts)
	}
}

func TestCheckOnceSkipsOnResolutionChange(t *testing.T) {
	var alerts []string
	c := newChecker(t, []*source.Frame{mkFrame(64, 48, 0, 0, 0), mkFrame(32, 24, 0, 0, 0)}, &alerts)
	c.CheckOnce(context.Background())
	if st := c.State(); st.LastRun != nil {
		t.Error("分辨率变化时本轮应跳过, 不更新 last_run")
	}
}

func TestCheckerUpdateTogglesEnabled(t *testing.T) {
	var alerts []string
	c := newChecker(t, nil, &alerts)
	if !c.Config().Enabled {
		t.Fatal("初始应为启用")
	}
	cfg := c.Config()
	cfg.Enabled = false
	c.Update(cfg)
	if c.Config().Enabled || c.State().Enabled {
		t.Error("Update 后应同步为禁用")
	}
}

func TestRunRespectsIntervalAndStopsOnCancel(t *testing.T) {
	same := mkFrame(32, 24, 0, 0, 0)
	frames := make([]*source.Frame, 0, 16)
	for i := 0; i < 16; i++ {
		frames = append(frames, same)
	}
	var alerts []string
	c := newChecker(t, frames, &alerts)
	cfg := c.Config()
	cfg.IntervalSec = 1
	cfg.FrozenChecks = 60 // 避免本用例真的告警
	c.Update(cfg)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); c.Run(ctx) }()

	deadline := time.After(3 * time.Second)
	for {
		if c.State().LastRun != nil {
			break
		}
		select {
		case <-deadline:
			t.Fatal("Run 未在 3s 内执行首次自检")
		case <-time.After(50 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
}

func TestRunDisabledDoesNotCheck(t *testing.T) {
	same := mkFrame(32, 24, 0, 0, 0)
	var alerts []string
	c := newChecker(t, []*source.Frame{same, same, same, same}, &alerts)
	cfg := c.Config()
	cfg.Enabled = false
	c.Update(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	c.Run(ctx)
	if st := c.State(); st.LastRun != nil {
		t.Error("禁用时不应执行自检")
	}
}
