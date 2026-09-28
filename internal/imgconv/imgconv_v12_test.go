package imgconv

import (
	"bytes"
	"image/jpeg"
	"testing"

	"camhub/internal/config"
	"camhub/internal/source"
)

// 造一帧高频噪声: 对 JPEG 来说是最"难压"的内容, 质量差异体现得最明显。
func noisyFrame(w, h int) *source.Frame {
	f := &source.Frame{W: w, H: h, Data: make([]byte, w*h*3)}
	x := uint32(12345)
	for i := range f.Data {
		x = x*1664525 + 1013904223
		f.Data[i] = byte(x >> 16)
	}
	return f
}

// v1.2: quality 必须真的传到编码器(同一帧, 高质量应明显更大)。
func TestEncodeJPEGQualityChangesSize(t *testing.T) {
	f := noisyFrame(320, 180)
	low := EncodeJPEGQuality(nil, f, 20)
	high := EncodeJPEGQuality(nil, f, 95)
	if len(low) == 0 || len(high) == 0 {
		t.Fatal("编码失败")
	}
	if len(high) <= len(low) {
		t.Errorf("quality=95 应比 quality=20 更大: %d vs %d", len(high), len(low))
	}
	for name, b := range map[string][]byte{"low": low, "high": high} {
		if !bytes.HasPrefix(b, []byte{0xff, 0xd8}) {
			t.Errorf("%s 不是合法 JPEG(缺 SOI)", name)
		}
		if _, err := jpeg.Decode(bytes.NewReader(b)); err != nil {
			t.Errorf("%s 无法被解码: %v", name, err)
		}
	}
}

// 脏值不能把预览链路搞挂: 包内钳制后仍要能出图。
func TestEncodeJPEGQualityClamped(t *testing.T) {
	f := noisyFrame(160, 90)
	for _, q := range []int{-100, 0, 1, 100, 9999} {
		if got := EncodeJPEGQuality(nil, f, q); len(got) == 0 {
			t.Errorf("quality=%d 时应仍能编码(包内钳制), 实际返回空", q)
		}
	}
}

// 默认入口应与 v1.1 的默认质量一致, 升级后行为不变。
func TestEncodeJPEGDefaultMatchesConfig(t *testing.T) {
	f := noisyFrame(640, 360)
	a := EncodeJPEG(nil, f)
	b := EncodeJPEGQuality(nil, f, config.DefaultPreviewQuality)
	if !bytes.Equal(a, b) {
		t.Error("EncodeJPEG 的默认质量应与 config.DefaultPreviewQuality 一致")
	}
}
