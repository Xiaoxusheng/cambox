package recorder

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"camhub/internal/config"
	"camhub/internal/source"
)

func mkFile(t *testing.T, path string, size int, mod time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatal(err)
	}
}

func TestCleanOnceRemovesExpired(t *testing.T) {
	root := t.TempDir()
	cfg := *config.Default()
	cfg.Record.Dir = filepath.Join(root, "recordings")
	cfg.Record.RetentionDays = 1
	snapDir := filepath.Join(root, "snapshots")

	now := time.Now()
	old := now.Add(-48 * time.Hour)
	mkFile(t, filepath.Join(cfg.Record.Dir, "old.mp4"), 100, old)
	mkFile(t, filepath.Join(cfg.Record.Dir, "new.mp4"), 100, now)
	mkFile(t, filepath.Join(snapDir, "events", "old.jpg"), 50, old)
	mkFile(t, filepath.Join(snapDir, "manual", "new.jpg"), 50, now)

	n, err := CleanOnce(cfg, snapDir)
	if err != nil {
		t.Fatalf("CleanOnce: %v", err)
	}
	if n != 2 {
		t.Errorf("应删除 2 个过期文件, got %d", n)
	}
	if _, err := os.Stat(filepath.Join(cfg.Record.Dir, "old.mp4")); !os.IsNotExist(err) {
		t.Error("过期录像应被删除")
	}
	if _, err := os.Stat(filepath.Join(cfg.Record.Dir, "new.mp4")); err != nil {
		t.Error("新录像应保留")
	}
	if _, err := os.Stat(filepath.Join(snapDir, "events", "old.jpg")); !os.IsNotExist(err) {
		t.Error("过期事件图应被删除")
	}
	if _, err := os.Stat(filepath.Join(snapDir, "manual", "new.jpg")); err != nil {
		t.Error("新抓拍应保留")
	}
}

func TestCleanOnceEnforcesCapacity(t *testing.T) {
	root := t.TempDir()
	cfg := *config.Default()
	cfg.Record.Dir = filepath.Join(root, "recordings")
	cfg.Record.RetentionDays = 365  // 不触发过期删除
	cfg.Record.MaxDiskGB = 0.000014 // ≈15KB, 只够放 1 个 10KB 文件
	snapDir := filepath.Join(root, "snapshots")

	now := time.Now()
	mkFile(t, filepath.Join(cfg.Record.Dir, "a.mp4"), 10*1024, now.Add(-3*time.Hour))
	mkFile(t, filepath.Join(cfg.Record.Dir, "b.mp4"), 10*1024, now.Add(-2*time.Hour))
	mkFile(t, filepath.Join(cfg.Record.Dir, "c.mp4"), 10*1024, now.Add(-1*time.Hour))

	n, err := CleanOnce(cfg, snapDir)
	if err != nil {
		t.Fatalf("CleanOnce: %v", err)
	}
	if n != 2 {
		t.Errorf("超容量应从最旧删起共删 2 个, got %d", n)
	}
	if _, err := os.Stat(filepath.Join(cfg.Record.Dir, "a.mp4")); !os.IsNotExist(err) {
		t.Error("最旧的 a.mp4 应被删除")
	}
	if _, err := os.Stat(filepath.Join(cfg.Record.Dir, "b.mp4")); !os.IsNotExist(err) {
		t.Error("次旧的 b.mp4 应被删除")
	}
	if _, err := os.Stat(filepath.Join(cfg.Record.Dir, "c.mp4")); err != nil {
		t.Error("最新的 c.mp4 应保留")
	}
}

func TestCleanOnceMissingDirs(t *testing.T) {
	cfg := *config.Default()
	cfg.Record.Dir = filepath.Join(t.TempDir(), "nope")
	n, err := CleanOnce(cfg, filepath.Join(t.TempDir(), "nope2"))
	if err != nil || n != 0 {
		t.Errorf("目录不存在应视为空, got n=%d err=%v", n, err)
	}
}

func TestRecordArgsShapes(t *testing.T) {
	cfg := *config.Default()
	cfg.Camera.RTSP = "rtsp://example/stream"
	cfg.Record.Dir = "recordings"

	copyArgs := recordArgs(cfg, ModeCopy)
	if !contains(copyArgs, "-c") || !contains(copyArgs, "copy") {
		t.Errorf("copy 模式应包含 -c copy: %v", copyArgs)
	}
	if contains(copyArgs, "libx264") {
		t.Errorf("copy 模式不应编码: %v", copyArgs)
	}

	encArgs := recordArgs(cfg, ModeEncode)
	if !contains(encArgs, "libx264") || !contains(encArgs, "pipe:0") {
		t.Errorf("encode 模式应包含 libx264 与 stdin 输入: %v", encArgs)
	}
	if !contains(encArgs, "bgr24") {
		t.Errorf("encode 模式应声明输入像素格式: %v", encArgs)
	}
}

func contains(args []string, s string) bool {
	for _, a := range args {
		if a == s {
			return true
		}
	}
	return false
}

// 契约 §2.2: 门控(record.effective)关闭时不得启动 ffmpeg 录像进程。
func TestGateClosedKeepsRecorderIdle(t *testing.T) {
	cfg := *config.Default()
	cfg.Record.Dir = filepath.Join(t.TempDir(), "recordings")

	src := source.New(cfg.Camera)
	gate := false
	r := New(src, func() config.Config { return cfg }, func() bool { return gate })

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); r.Run(ctx) }()

	time.Sleep(700 * time.Millisecond)
	if st := r.Status(); st.Running {
		t.Error("门控关闭时不应处于录像中")
	}
	if _, err := os.Stat(cfg.Record.Dir); err == nil {
		entries, _ := os.ReadDir(cfg.Record.Dir)
		if len(entries) > 0 {
			t.Error("门控关闭时不应产生录像文件")
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
}

// gate 为 nil 时退化为只看 record.enabled, 保持向后兼容。
func TestNilGateMeansAllowed(t *testing.T) {
	cfg := *config.Default()
	src := source.New(cfg.Camera)
	r := New(src, func() config.Config { return cfg }, nil)
	if !r.allowed() {
		t.Error("gate 为 nil 时应视为放行")
	}

	r2 := New(src, func() config.Config { return cfg }, func() bool { return false })
	if r2.allowed() {
		t.Error("gate 返回 false 时应视为关闭")
	}
}

// 门控关闭必须以 errGateClosed 结束 runOnce, 而不是被当成进程故障反复退避。
func TestGateClosedSentinelIsRecognized(t *testing.T) {
	if !errors.Is(fmt.Errorf("包装: %w", errGateClosed), errGateClosed) {
		t.Error("errGateClosed 应可用 errors.Is 识别")
	}
	if errors.Is(errSettingsChanged, errGateClosed) {
		t.Error("两种退出原因必须区分")
	}
}
