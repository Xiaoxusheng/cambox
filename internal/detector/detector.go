// Package detector 实现移动侦测(帧差法)。设计见 docs/开发文档.md §4.4。
// Detector 接口预留后续 AI 实现(如 YOLO)替换。
package detector

import (
	"image"
	"sync"
	"time"

	"camhub/internal/config"
	"camhub/internal/source"
)

// Detection 一次触发结果; Rect 为原始分辨率坐标系的外接框。
type Detection struct {
	Score int
	Rect  image.Rectangle
}

// Detector 单帧检测接口; 实现自行维护跨帧状态, 须由单一 goroutine 串行调用。
type Detector interface {
	Detect(f *source.Frame) (Detection, bool)
}

// Motion 帧差法: 降采样灰度 → absdiff → 阈值计数 → 冷却。
type Motion struct {
	mu       sync.Mutex
	cfg      config.MotionConfig
	prev     []byte // 上一帧降采样灰度
	cur      []byte // 复用缓冲
	pw, ph   int
	lastFire time.Time
}

func New(cfg config.MotionConfig) *Motion {
	return &Motion{cfg: cfg}
}

// SetConfig 热更新参数, 下一次 Detect 生效; 参数变化时自动重建基线。
func (m *Motion) SetConfig(cfg config.MotionConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cfg.DownscaleWidth != cfg.DownscaleWidth {
		m.prev = nil
	}
	m.cfg = cfg
}

// Detect 处理一帧。首帧/尺寸变化只建立基线不触发。
func (m *Motion) Detect(f *source.Frame) (Detection, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	dw := m.cfg.DownscaleWidth
	dh := f.H * dw / f.W
	if dh < 1 {
		dh = 1
	}
	if cap(m.cur) < dw*dh {
		m.cur = make([]byte, dw*dh)
	}
	cur := m.cur[:dw*dh]
	toGray(f, cur, dw, dh)

	if len(m.prev) != len(cur) || m.pw != dw {
		m.prev = append(m.prev[:0], cur...)
		m.pw, m.ph = dw, dh
		return Detection{}, false
	}

	count, rect := diff(m.prev, cur, dw, dh, m.cfg.Threshold)
	m.prev, m.cur = cur, m.prev // 交换复用缓冲
	if count < m.cfg.MinArea {
		return Detection{}, false
	}
	if time.Since(m.lastFire) < time.Duration(m.cfg.CooldownSec)*time.Second {
		return Detection{}, false
	}
	m.lastFire = time.Now()
	return Detection{
		Score: count,
		Rect:  scaleRect(rect, dw, dh, f.W, f.H),
	}, true
}

// toGray 最近邻降采样为灰度图。
func toGray(f *source.Frame, dst []byte, dw, dh int) {
	for y := 0; y < dh; y++ {
		sy := y * f.H / dh
		row := sy * f.W
		for x := 0; x < dw; x++ {
			sx := x * f.W / dw
			i := (row + sx) * 3 // BGR24
			b, g, r := int(f.Data[i]), int(f.Data[i+1]), int(f.Data[i+2])
			dst[y*dw+x] = byte((299*r + 587*g + 114*b) / 1000)
		}
	}
}

// diff 统计变化像素并求外接框(降采样坐标系)。
func diff(prev, cur []byte, w, h, threshold int) (int, image.Rectangle) {
	count := 0
	rect := image.Rectangle{}
	first := true
	for y := 0; y < h; y++ {
		row := y * w
		for x := 0; x < w; x++ {
			d := int(cur[row+x]) - int(prev[row+x])
			if d > threshold || d < -threshold {
				count++
				if first {
					rect = image.Rect(x, y, x+1, y+1)
					first = false
				} else {
					if x < rect.Min.X {
						rect.Min.X = x
					}
					if y < rect.Min.Y {
						rect.Min.Y = y
					}
					if x+1 > rect.Max.X {
						rect.Max.X = x + 1
					}
					if y+1 > rect.Max.Y {
						rect.Max.Y = y + 1
					}
				}
			}
		}
	}
	return count, rect
}

// scaleRect 将降采样坐标外接框映射回原始分辨率。
func scaleRect(r image.Rectangle, sw, sh, fw, fh int) image.Rectangle {
	x1 := clampInt(r.Min.X*fw/sw, 0, fw-1)
	y1 := clampInt(r.Min.Y*fh/sh, 0, fh-1)
	x2 := clampInt(r.Max.X*fw/sw, x1+1, fw)
	y2 := clampInt(r.Max.Y*fh/sh, y1+1, fh)
	return image.Rect(x1, y1, x2, y2)
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
