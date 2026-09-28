/** 统一数据格式化工具（全站唯一实现，禁止页面各写一份） */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024
const TB = GB * 1024

/** 文件大小：1024 进制，一位小数 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < KB) return `${n} B`
  if (n < MB) return `${(n / KB).toFixed(1)} KB`
  if (n < GB) return `${(n / MB).toFixed(1)} MB`
  if (n < TB) return `${(n / GB).toFixed(2)} GB`
  return `${(n / TB).toFixed(2)} TB`
}

/** 运行时长：1d 2h 3m 4s（省略前导零单位） */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '-'
  const s = Math.floor(totalSec % 60)
  const m = Math.floor((totalSec / 60) % 60)
  const h = Math.floor((totalSec / 3600) % 24)
  const d = Math.floor(totalSec / 86400)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 || parts.length === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

/** 运行时长（概览卡样式）：3天 14:06；不足 1 天只显示 时:分 */
export function formatUptime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '-'
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec / 3600) % 24)
  const m = Math.floor((totalSec / 60) % 60)
  const hm = `${pad(h)}:${pad(m)}`
  return d > 0 ? `${d}天 ${hm}` : hm
}

/** 字节数 → GB（一位小数，配「x.x / 20 GB」展示） */
export function formatGB(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  return (n / (1024 ** 3)).toFixed(1)
}

/** 时长（播放器用）：恒 HH:MM:SS */
export function formatClockLong(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** RFC3339 → 本地 "MM-DD HH:mm:ss"；无效值返回 '-' */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** RFC3339 → 本地 "YYYY-MM-DD HH:mm:ss"（事件中心时间列，设计稿 03） */
export function formatDateTimeFull(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** RFC3339 → 本地 "HH:mm:ss" */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 本地日期 → "YYYY-MM-DD" */
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 时钟显示 "HH:mm:ss" */
export function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 时钟显示 "YYYY-MM-DD HH:mm:ss"（监控页 LIVE 遮罩用） */
export function formatClockFull(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(d)}`
}

/** 秒 → "MM:SS" / "HH:MM:SS"（播放器用） */
export function formatClockDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

/** 事件类型 → 中文标签 */
export function eventTypeLabel(type: string, detail?: string): string {
  if (type === 'motion') return '移动侦测'
  if (type === 'selfcheck') {
    if (detail === 'frozen') return '画面冻结'
    if (detail === 'occlusion') return '画面异常'
    return '自检'
  }
  return type
}

/** 事件标题强调色（设计稿：侦测=青 / 冻结=黄 / 异常=红） */
export function eventAccent(type: string, detail?: string): '' | 'cyan' | 'warn' | 'danger' {
  if (type === 'motion') return 'cyan'
  if (detail === 'occlusion') return 'danger'
  if (type === 'selfcheck') return 'warn'
  return ''
}

/** 事件副标题：motion → 相机名；selfcheck → 画面自检 C3 */
export function eventSubLabel(type: string, cameraName?: string): string {
  return type === 'motion' ? cameraName || '摄像头' : '画面自检 C3'
}

/** 自检状态 → 文案 / 颜色 / 状态点（概览与监控页共用）；正常态用中性白（Profound 单色风） */
export function selfCheckView(s: {
  enabled: boolean
  state: string
}): { text: string; color: string; dot: string } {
  if (!s.enabled) return { text: '已关闭', color: 'var(--color-text-3)', dot: 'off' }
  if (s.state === 'frozen') return { text: '画面冻结', color: 'var(--ch-danger)', dot: 'err' }
  if (s.state === 'occlusion') return { text: '画面异常', color: 'var(--ch-warn)', dot: 'warn' }
  return { text: '正常', color: 'var(--ch-text-1)', dot: 'ok' }
}
