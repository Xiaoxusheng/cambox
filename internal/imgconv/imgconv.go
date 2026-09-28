// Package imgconv 提供 BGR24 裸帧与 image.RGBA / JPEG 的转换及画框工具,
// 供 pipeline(事件快照) 与 server(MJPEG/抓拍) 共用。
package imgconv

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"

	"camhub/internal/config"
	"camhub/internal/source"
)

// ToRGBA 将 BGR24 裸帧转为 *image.RGBA。
func ToRGBA(f *source.Frame) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, f.W, f.H))
	for y := 0; y < f.H; y++ {
		src := f.Data[y*f.W*3 : (y+1)*f.W*3]
		dst := img.Pix[y*img.Stride : y*img.Stride+f.W*4]
		for x := 0; x < f.W; x++ {
			s, d := x*3, x*4
			dst[d] = src[s+2]   // R
			dst[d+1] = src[s+1] // G
			dst[d+2] = src[s]   // B
			dst[d+3] = 0xff
		}
	}
	return img
}

// EncodeJPEG 将裸帧编码为 JPEG(默认质量), 追加到 dst 并返回。
func EncodeJPEG(dst []byte, f *source.Frame) []byte {
	return EncodeJPEGQuality(dst, f, config.DefaultPreviewQuality)
}

// EncodeJPEGQuality v1.2: 质量可调(camera.preview_quality), 追加到 dst 并返回。
//
// 质量在包内钳到 1~100: jpeg.Encode 对越界质量会直接返回错误, 与其让调用方
// (MJPEG 循环每拍都调) 依赖"配置一定合法", 不如在这里兜底 —— 配置被热更新成脏值时
// 最多是画质变化, 不会整条预览链路静默中断。
func EncodeJPEGQuality(dst []byte, f *source.Frame, quality int) []byte {
	if quality < 1 {
		quality = 1
	}
	if quality > 100 {
		quality = 100
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, ToRGBA(f), &jpeg.Options{Quality: quality}); err != nil {
		return dst // 编码失败返回原缓冲, 调用方按空帧处理
	}
	return append(dst, b.Bytes()...)
}

// DrawRect 在图上画 2px 实线边框, 自动裁剪到图内。
func DrawRect(img *image.RGBA, r image.Rectangle, c color.RGBA) {
	b := img.Bounds()
	r = r.Canon().Intersect(b)
	if r.Empty() {
		return
	}
	const thick = 2
	for t := 0; t < thick; t++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			if y := r.Min.Y + t; y < b.Max.Y {
				img.SetRGBA(x, y, c)
			}
			if y := r.Max.Y - 1 - t; y >= 0 {
				img.SetRGBA(x, y, c)
			}
		}
		for y := r.Min.Y; y < r.Max.Y; y++ {
			if x := r.Min.X + t; x < b.Max.X {
				img.SetRGBA(x, y, c)
			}
			if x := r.Max.X - 1 - t; x >= 0 {
				img.SetRGBA(x, y, c)
			}
		}
	}
}
