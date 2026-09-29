/**
 * 自动裁切内嵌黑边的图片展示（事件快照 / 抓拍结果弹窗用）。
 * 拉流源若是"电影级宽画幅内容嵌在 16:9 容器里"（测试流常见），快照上下会带黑边；
 * 这里在加载后用小尺寸 canvas 扫描近黑行列，检测出内容区后按内容区比例铺满容器。
 * 检测不到明显黑边（真实摄像头画面 / mock 占位图）时原样展示，不裁任何内容。
 */
import { useState } from 'react'
import type { SyntheticEvent } from 'react'

/** 归一化内容区（0~1，相对原图宽高） */
type ContentBox = { x0: number; y0: number; x1: number; y1: number }

/** 行/列平均亮度低于该值视为黑边（0~255）。黑边是纯黑；暗场景有噪声，均值高于此值，避免误判 */
const BLACK_LUMA = 12
/** 内容区小于原图该比例时视为误判，放弃裁切 */
const MIN_CONTENT_RATIO = 0.5

function detectContentBox(img: HTMLImageElement): ContentBox | null {
  const sw = 96
  const sh = Math.max(2, Math.round((img.naturalHeight / img.naturalWidth) * sw))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, sw, sh)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, sw, sh).data
  } catch {
    return null // 跨域污染等情况下放弃裁切
  }

  const rowLuma = new Array(sh).fill(0)
  const colLuma = new Array(sw).fill(0)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      rowLuma[y] += luma
      colLuma[x] += luma
    }
  }
  for (let y = 0; y < sh; y++) rowLuma[y] /= sw
  for (let x = 0; x < sw; x++) colLuma[x] /= sw

  const firstBright = (arr: number[]) => arr.findIndex((v) => v > BLACK_LUMA)
  const lastBright = (arr: number[]) => arr.length - 1 - [...arr].reverse().findIndex((v) => v > BLACK_LUMA)
  const y0 = firstBright(rowLuma)
  const y1 = lastBright(rowLuma)
  const x0 = firstBright(colLuma)
  const x1 = lastBright(colLuma)
  if (y0 < 0 || x0 < 0) return null

  const box: ContentBox = { x0: x0 / sw, y0: y0 / sh, x1: (x1 + 1) / sw, y1: (y1 + 1) / sh }
  if (box.x1 - box.x0 < MIN_CONTENT_RATIO || box.y1 - box.y0 < MIN_CONTENT_RATIO) return null
  // 没有可裁的黑边时无需特殊布局
  if (box.x0 === 0 && box.y0 === 0 && box.x1 === 1 && box.y1 === 1) return null
  return box
}

export function AutoCropImage({ src, alt, radius = 8 }: { src: string; alt: string; radius?: number }) {
  const [box, setBox] = useState<ContentBox | null>(null)
  const [ratio, setRatio] = useState<number | null>(null)

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const detected = detectContentBox(img)
    if (detected) {
      const w = (detected.x1 - detected.x0) * img.naturalWidth
      const h = (detected.y1 - detected.y0) * img.naturalHeight
      setRatio(w / h)
      setBox(detected)
    }
  }

  if (!box || !ratio) {
    return <img src={src} alt={alt} onLoad={handleLoad} style={{ width: '100%', borderRadius: radius, display: 'block' }} />
  }

  // 容器比例 = 内容区比例；原图放大到内容区恰好铺满容器，黑边溢出被裁掉。
  // 宽高同时按内容区偏移定位，上下黑边（letterbox）与左右黑边（pillarbox）都成立。
  const contentW = box.x1 - box.x0
  const contentH = box.y1 - box.y0
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${ratio}`,
        overflow: 'hidden',
        borderRadius: radius,
        background: '#000',
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          position: 'absolute',
          width: `${(1 / contentW) * 100}%`,
          height: `${(1 / contentH) * 100}%`,
          left: `${-(box.x0 / contentW) * 100}%`,
          top: `${-(box.y0 / contentH) * 100}%`,
        }}
      />
    </div>
  )
}
