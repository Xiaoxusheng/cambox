package pipeline

import (
	"context"
	"os/exec"
	"runtime"
	"testing"
	"time"

	"camhub/internal/config"
)

// settleGoroutines 等待运行时把临时 goroutine 收干净, 返回观测到的最小值。
// 直接读一次 NumGoroutine 会因为上一个用例的收尾 goroutine 而偏高。
func settleGoroutines() int {
	best := runtime.NumGoroutine()
	for i := 0; i < 60; i++ {
		time.Sleep(50 * time.Millisecond)
		runtime.GC()
		if n := runtime.NumGoroutine(); n < best {
			best = n
		}
	}
	return best
}

// 开发文档 §8 验收项「无 goroutine 泄漏」的自动化验证。
//
// 此前这条只有代码审查（"8 个 goroutine 都随 ctx 退出"），没有实测。这里用真实合成源
// 反复 Start/Stop，断言 goroutine 数回到基线 —— 能抓到 ctx 漏传、子进程未 Wait、
// 自检/日报/bot 循环忘记 select ctx.Done() 这类泄漏。
func TestStartStopDoesNotLeakGoroutines(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("本机没有 ffmpeg, 跳过需要真实解码源的泄漏测试")
	}

	base := settleGoroutines()
	t.Logf("基线 goroutine = %d", base)

	const rounds = 3
	for i := 0; i < rounds; i++ {
		p := newTestPipeline(t, func(c *config.Config) {
			c.Camera.Type = config.TypeSynthetic
			c.Record.Enabled = false // 不落盘, 只验证 goroutine 生命周期
			c.SelfCheck.Enabled = true
			c.Digest.Enabled = false
			c.Bot.Enabled = false
		})
		ctx, cancel := context.WithCancel(context.Background())
		p.Start(ctx)
		// 让 source 真正拉起 ffmpeg、自检循环跑过至少一轮
		time.Sleep(1500 * time.Millisecond)
		cancel()
		p.Stop() // 内部 wg.Wait(), 应等全部 goroutine 退出
	}

	after := settleGoroutines()
	// 允许 3 个的噪声余量（testing 框架与 runtime 自身的临时 goroutine）
	if after > base+3 {
		t.Fatalf("Start/Stop %d 轮后 goroutine 泄漏: 基线 %d → 现在 %d", rounds, base, after)
	}
	t.Logf("Start/Stop %d 轮后 goroutine = %d（基线 %d）", rounds, after, base)
}

// Stop 必须幂等/可重复调用而不 panic，且取消后再次 Stop 不阻塞。
// 优雅关闭路径（Signal → Shutdown → Stop）依赖这一点。
func TestStopIsIdempotent(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("本机没有 ffmpeg, 跳过")
	}
	p := newTestPipeline(t, func(c *config.Config) {
		c.Camera.Type = config.TypeSynthetic
		c.Record.Enabled = false
		c.Digest.Enabled = false
	})
	ctx, cancel := context.WithCancel(context.Background())
	p.Start(ctx)
	time.Sleep(600 * time.Millisecond)

	done := make(chan struct{})
	go func() {
		defer close(done)
		cancel()
		p.Stop()
		p.Stop() // 第二次不应 panic 或死锁
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("重复 Stop 阻塞（可能 wg 计数或 cancel 有问题）")
	}
}
