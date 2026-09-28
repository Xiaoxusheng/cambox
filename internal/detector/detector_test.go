package detector

import (
	"image"
	"testing"
	"time"

	"camhub/internal/config"
	"camhub/internal/source"
)

func grayFrame(w, h int, fill byte) *source.Frame {
	f := &source.Frame{W: w, H: h, Data: make([]byte, w*h*3)}
	for i := range f.Data {
		f.Data[i] = fill
	}
	return f
}

// fillRect 将区域内像素填为指定灰度(BGR 同值)。
func fillRect(f *source.Frame, r image.Rectangle, v byte) {
	for y := r.Min.Y; y < r.Max.Y && y < f.H; y++ {
		for x := r.Min.X; x < r.Max.X && x < f.W; x++ {
			i := (y*f.W + x) * 3
			f.Data[i], f.Data[i+1], f.Data[i+2] = v, v, v
		}
	}
}

func newMotion() *Motion {
	return New(config.MotionConfig{
		Enabled: true, Threshold: 22, MinArea: 100, CooldownSec: 8, DownscaleWidth: 32,
	})
}

func TestMotionTriggersOnMovingBox(t *testing.T) {
	m := newMotion()
	f1 := grayFrame(64, 64, 100)
	if _, fired := m.Detect(f1); fired {
		t.Fatal("首帧只建立基线, 不应触发")
	}

	f2 := grayFrame(64, 64, 100)
	fillRect(f2, image.Rect(16, 16, 48, 48), 200)
	d, fired := m.Detect(f2)
	if !fired {
		t.Fatal("出现移动方块应触发")
	}
	if d.Score != 256 {
		t.Errorf("变化像素数 = %d, want 256", d.Score)
	}
	if d.Rect != (image.Rect(16, 16, 48, 48)) {
		t.Errorf("外接框 = %v, want (16,16)-(48,48)", d.Rect)
	}
}

func TestMotionNoTriggerOnStatic(t *testing.T) {
	m := newMotion()
	m.Detect(grayFrame(64, 64, 100))
	for i := 0; i < 5; i++ {
		if _, fired := m.Detect(grayFrame(64, 64, 100)); fired {
			t.Fatalf("静止画面第 %d 次不应触发", i)
		}
	}
}

func TestMotionCooldown(t *testing.T) {
	m := newMotion()
	m.cfg.CooldownSec = 1

	m.Detect(grayFrame(64, 64, 100))
	f2 := grayFrame(64, 64, 100)
	fillRect(f2, image.Rect(0, 0, 24, 24), 220)
	if _, fired := m.Detect(f2); !fired {
		t.Fatal("第一次移动应触发")
	}

	// 冷却期内的再次移动不触发
	f3 := grayFrame(64, 64, 100)
	fillRect(f3, image.Rect(40, 40, 64, 64), 220)
	if _, fired := m.Detect(f3); fired {
		t.Fatal("冷却期内不应触发")
	}

	time.Sleep(1100 * time.Millisecond)
	f4 := grayFrame(64, 64, 100)
	fillRect(f4, image.Rect(40, 0, 64, 24), 220)
	if _, fired := m.Detect(f4); !fired {
		t.Fatal("冷却期过后应再次触发")
	}
}

func TestMotionSmallChangeIgnored(t *testing.T) {
	m := newMotion()
	m.Detect(grayFrame(64, 64, 100))
	// 噪声级别的亮度抖动(阈值 22 以下)不应触发
	f2 := grayFrame(64, 64, 110)
	if _, fired := m.Detect(f2); fired {
		t.Fatal("阈值内变化不应触发")
	}
}

func TestSetConfigRebuildsBaseline(t *testing.T) {
	m := newMotion()
	m.Detect(grayFrame(64, 64, 100))
	m.SetConfig(config.MotionConfig{
		Enabled: true, Threshold: 22, MinArea: 100, CooldownSec: 8, DownscaleWidth: 64,
	})
	// 检测宽度变化 → 重建基线, 不应直接触发
	if _, fired := m.Detect(grayFrame(64, 64, 100)); fired {
		t.Fatal("参数变更后首帧应重建基线")
	}
}

func TestScaleRectClamps(t *testing.T) {
	got := scaleRect(image.Rect(0, 0, 64, 64), 32, 32, 64, 64)
	if got != image.Rect(0, 0, 64, 64) {
		t.Errorf("全图框应映射为全图, got %v", got)
	}
}
