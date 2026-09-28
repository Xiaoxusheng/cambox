/**
 * 媒体资源 URL 适配层。
 *
 * 真实模式：直接返回后端路径（/api/stream.mjpeg、/api/snapshot、/media/**）。
 * mock 模式：/media/** 与快照用确定性 SVG 顶替，保证离线可自查；
 *          录像 mp4 无法伪造，返回 null，由页面显式提示"mock 模式无视频源"。
 */
import { IS_MOCK } from './client'
import { mockMediaSvg } from './mock'

export { IS_MOCK }

/** 后端返回的图片路径（事件快照 / 手动抓拍）→ 可用的 <img src> */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (path.startsWith('data:') || path.startsWith('blob:')) return path
  if (!IS_MOCK) return path
  const name = path.split('/').pop() ?? path
  const isSelfCheck = name.startsWith('ev-')
  return mockMediaSvg(path, isSelfCheck ? `event ${name.slice(3, 18)}` : `snapshot ${name}`)
}

/** MJPEG 实时流地址；mock 模式下返回 null（由 useStreamFrame 逐帧伪造） */
export function streamUrl(): string | null {
  return IS_MOCK ? null : '/api/stream.mjpeg'
}

/** 当前帧快照（用于 ROI 编辑底图，必须是稳定不跳变的静态图） */
export function snapshotUrl(bust = Date.now()): string {
  return IS_MOCK ? mockMediaSvg('camhub-static-snapshot', 'live frame') : `/api/snapshot?t=${bust}`
}

/** 录像播放地址；mock 模式返回 null */
export function recordingUrl(name: string): string | null {
  if (!name) return null
  return IS_MOCK ? null : `/media/recordings/${encodeURIComponent(name)}`
}

/** mock 模式下的"实时"逐帧画面（seq 递增即换一帧） */
export function mockFrameSrc(seq: number): string {
  const bucket = Math.floor(seq / 8)
  return mockMediaSvg(`frame-${bucket}`, `live · ${String(seq % 100).padStart(2, '0')}`)
}
