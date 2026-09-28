/**
 * Mock 数据层 —— `VITE_API_MODE=mock` 时由 client.ts 转发至此。
 *
 * 约束：
 * 1. 所有返回值的**字段与形状严格遵循** docs/contracts/api-v1.1.md，不做任何字段增减；
 *    仅字段「取值」是伪造的（这是 mock 的本职）。
 * 2. 有状态：arm / config / 事件删除 / 录像删除在会话内真实生效，便于前端自查交互闭环。
 * 3. 媒体类端点（GET /api/snapshot、GET /api/stream.mjpeg、GET /media/*、GET /api/logs/stream）
 *    不返回 JSON，无法走本模块，由 api/media.ts 与 api/logStream.ts 在 mock 下生成等价物。
 * 4. 数据确定性：使用固定种子的 PRNG，刷新页面数据不跳变。
 */
import { ApiError } from './errors'
import type {
  ApiResponse,
  ArmRequest,
  ArmResponse,
  BatchDeleteRequest,
  BatchDeleteResponse,
  Config,
  Event,
  EventsResponse,
  LogEntry,
  ManualSnapshotResponse,
  NotifyTestResponse,
  RecordFile,
  RecordingsResponse,
  Roi,
  ScheduleRule,
  Status,
  TimelineData,
  TimelineSegment,
} from './types'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Date → 本地时区 RFC3339（与 Go time.Time JSON 序列化一致） */
function rfc3339(d: Date): string {
  const tzMin = -d.getTimezoneOffset()
  const sign = tzMin >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(tzMin) / 60))}:${pad(Math.abs(tzMin) % 60)}`
  )
}

const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const compactDate = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const compactTime = (d: Date) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** mulberry32：小体积确定性 PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 简单字符串散列，用于把媒体路径稳定映射到一张确定性的假图 */
function hashCode(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// 媒体占位图：mock 模式下 /media/** 与 /api/snapshot 用确定性 SVG 顶替，
// 保证离线也能看到"画面"，不影响真实模式（真实模式直接走原 URL）。
// ---------------------------------------------------------------------------

export function mockMediaSvg(seedText: string, label: string): string {
  const h = hashCode(seedText)
  const r = mulberry32(h)
  // 场景元素位置随 seed 变化，看起来像不同时刻的画面
  const px = 60 + Math.floor(r() * 300)
  const py = 90 + Math.floor(r() * 90)
  const pw = 34 + Math.floor(r() * 26)
  const ph = 60 + Math.floor(r() * 40)
  const boxX = Math.max(8, px - 22)
  const boxY = Math.max(8, py - 20)
  const noise = Array.from({ length: 7 }, () => {
    const y = Math.floor(r() * 270)
    return `<rect x="0" y="${y}" width="480" height="1" fill="#ffffff" opacity="${(
      0.02 + r() * 0.05
    ).toFixed(3)}"/>`
  }).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1a2830"/><stop offset="1" stop-color="#0b1114"/>` +
    `</linearGradient></defs>` +
    `<rect width="480" height="270" fill="url(#bg)"/>` +
    `<path d="M0 196 L120 176 L240 190 L360 168 L480 186 L480 270 L0 270 Z" fill="#121c21"/>` +
    `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="6" fill="#2f4351"/>` +
    `<circle cx="${px + pw / 2}" cy="${py - 10}" r="10" fill="#3a5262"/>` +
    `<rect x="${boxX}" y="${boxY}" width="${pw + 44}" height="${ph + 40}" fill="none" ` +
    `stroke="#46b26b" stroke-width="2" stroke-dasharray="6 4"/>` +
    noise +
    `<rect x="0" y="0" width="480" height="22" fill="#000000" opacity="0.45"/>` +
    `<text x="8" y="15" font-family="monospace" font-size="11" fill="#c9d6de">` +
    `${label}</text>` +
    `<text x="472" y="262" text-anchor="end" font-family="monospace" font-size="10" ` +
    `fill="#8a9aa5">MOCK · camhub v1.1</text>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------------------
// 默认配置（= 契约 §1 示例值）
// ---------------------------------------------------------------------------

function defaultConfig(): Config {
  return {
    camera: {
      name: '模拟摄像头',
      type: 'synthetic',
      rtsp: '',
      sub_rtsp: '',
      file: '',
      dshow_device: '',
      width: 1280,
      height: 720,
      fps: 25,
      reconnect_delay_sec: 3,
      url: '',
      preview_quality: 80,
      preview_fps: 15,
    },
    motion: {
      enabled: true,
      threshold: 22,
      min_area: 500,
      cooldown_sec: 8,
      downscale_width: 320,
      // mock 默认给一个 ROI，便于离线自查监控页覆盖框与设置页 ROI 编辑器（真实后端默认全屏）
      rois: [[0.18, 0.12, 0.37, 0.56]],
    },
    record: {
      enabled: true,
      dir: 'recordings',
      segment_seconds: 600,
      retention_days: 7,
      max_disk_gb: 20,
      encode_crf: 26,
    },
    notify: {
      cooldown_sec: 60,
      dingtalk: { enabled: false, webhook: '', secret: '' },
      wecom: { enabled: false, webhook: '' },
      telegram: { enabled: false, bot_token: '', chat_id: '' },
      bark: { enabled: false, server: 'https://api.day.app', device_key: '' },
      webhook: { enabled: false, url: '', secret: '' },
    },
    schedules: {
      rules: [
        { days: [1, 2, 3, 4, 5], start: '08:00', end: '22:00', motion: true, record: true },
        { days: [6, 7], start: '00:00', end: '00:00', motion: true, record: true },
      ],
    },
    selfcheck: {
      enabled: true,
      interval_sec: 300,
      frozen_checks: 3,
      change_threshold: 25,
      change_checks: 3,
    },
    digest: { enabled: true, time: '22:00' },
    bot: { enabled: false, bot_token: '', allowed_users: [] },
  }
}

// ---------------------------------------------------------------------------
// 种子数据
// ---------------------------------------------------------------------------

const EVENT_DAYS = 7
const MAX_ROIS = 8

function snapPath(t: Date, kind: 'events' | 'manual', seq = 1): string {
  return kind === 'events'
    ? `/media/snapshots/events/ev-${compactDate(t)}-${compactTime(t)}-${pad(seq, 3)}.jpg`
    : `/media/snapshots/manual/snap-${compactDate(t)}-${compactTime(t)}.jpg`
}

function seedEvents(): Event[] {
  const rnd = mulberry32(20260928)
  const out: Event[] = []
  const today = startOfDay(new Date())
  const now = Date.now()
  for (let d = EVENT_DAYS - 1; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 86400000)
    const count = 6 + Math.floor(rnd() * 16)
    let seq = 1
    for (let i = 0; i < count; i++) {
      const t = new Date(day)
      t.setHours(6 + Math.floor(rnd() * 17), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0)
      if (t.getTime() > now) continue
      const isSelf = rnd() < 0.14
      out.push({
        id: 0,
        time: rfc3339(t),
        type: isSelf ? 'selfcheck' : 'motion',
        score: isSelf ? 0 : 300 + Math.floor(rnd() * 1200),
        image: snapPath(t, 'events', seq++),
        detail: isSelf ? (rnd() < 0.5 ? 'frozen' : 'occlusion') : '',
      })
    }
  }
  out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  out.forEach((e, i) => {
    e.id = i + 1
  })
  return out
}

// mock 不伪造录像文件：mp4 无法造假，列表保持为空（录像管理/回看显示空态），
// 真实模式由后端提供真实分段
function seedRecordings(): RecordFile[] {
  return []
}

// ---------------------------------------------------------------------------
// 会话内可变状态
// ---------------------------------------------------------------------------

let armed = true
let config: Config = defaultConfig()
let events: Event[] = seedEvents()
let recordings: RecordFile[] = seedRecordings()
let manualSnapshots: string[] = []
const BOOT_AT = Date.now()
const BASE_UPTIME_SEC = 2 * 86400 + 7 * 3600 + 12 * 60

// ---------------------------------------------------------------------------
// 派生数据
// ---------------------------------------------------------------------------

/** 契约 §2.2：rules 为空 = 全天生效；start==end 视为全天；end<start 跨零点 */
function evalSchedule(rules: ScheduleRule[], now: Date): { motion: boolean; record: boolean } {
  if (!rules || rules.length === 0) return { motion: true, record: true }
  const dow = now.getDay() === 0 ? 7 : now.getDay() // 1=周一 ... 7=周日
  const cur = now.getHours() * 60 + now.getMinutes()
  const hit: { motion: boolean; record: boolean } = { motion: false, record: false }
  for (const r of rules) {
    if (!r.days || !r.days.includes(dow)) continue
    const [sh, sm] = r.start.split(':').map(Number)
    const [eh, em] = r.end.split(':').map(Number)
    const s = sh * 60 + sm
    const e = eh * 60 + em
    const inRange = s === e ? true : s < e ? cur >= s && cur <= e : cur >= s || cur <= e
    if (inRange) {
      hit.motion = hit.motion || r.motion
      hit.record = hit.record || r.record
    }
  }
  return hit
}

function diskUsed(): { recordings_bytes: number; snapshots_bytes: number } {
  return {
    recordings_bytes: recordings.reduce((s, r) => s + r.size_bytes, 0),
    snapshots_bytes: events.length * 46 * 1024 + manualSnapshots.length * 180 * 1024,
  }
}

function currentStatus(): Status {
  const now = new Date()
  const disk = diskUsed()
  const sched = evalSchedule(config.schedules.rules, now)
  const last = recordings[recordings.length - 1]
  return {
    time: rfc3339(now),
    uptime_sec: BASE_UPTIME_SEC + Math.floor((Date.now() - BOOT_AT) / 1000),
    camera: {
      name: config.camera.name,
      type: config.camera.type,
      connected: true,
      fps: 24.6 + (Date.now() % 9) / 10,
      width: config.camera.width,
      height: config.camera.height,
      restarts: 0,
      last_error: '',
    },
    recorder: {
      enabled: config.record.enabled,
      running: config.record.enabled && sched.record,
      mode: 'encode',
      current_file: last ? last.name : '',
      last_error: '',
    },
    motion: { enabled: config.motion.enabled },
    disk: { ...disk, max_gb: config.record.max_disk_gb },
    events_count: events.length,
    ffmpeg_log: [
      '[synthetic] frame=  1000 fps=25 q=-0.0 size=    1024kB time=00:00:40.00',
      '[synthetic] frame=  1250 fps=25 q=-0.0 size=    1280kB time=00:00:50.00',
    ],
    armed,
    schedule_active: sched,
    selfcheck: {
      enabled: config.selfcheck.enabled,
      last_run: rfc3339(new Date(now.getTime() - 96_000)),
      state: 'ok',
      last_alert: '',
      consecutive_frozen: 0,
      consecutive_change: 0,
    },
  }
}

const timelineCache = new Map<string, TimelineData>()

function buildTimeline(date: string): TimelineData {
  const cached = timelineCache.get(date)
  if (cached) return cached
  const segments: TimelineSegment[] = recordings
    .filter((r) => r.name.startsWith(date))
    .map((r) => ({
      name: r.name,
      start: r.start as string,
      end: r.end as string,
      size_bytes: r.size_bytes,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : 1))
  const dayEvents = events
    .filter((e) => e.time.startsWith(date))
    .sort((a, b) => (a.time < b.time ? -1 : 1))
  const hourly = new Array<number>(24).fill(0)
  for (const e of dayEvents) {
    const h = new Date(e.time).getHours()
    if (h >= 0 && h < 24) hourly[h] += 1
  }
  const data: TimelineData = { date, segments, events: dayEvents, hourly }
  timelineCache.set(date, data)
  return data
}

// ---------------------------------------------------------------------------
// 配置写入校验（镜像契约 §1「钳制规则」）
// ---------------------------------------------------------------------------

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function sanitize(incoming: Config): Config {
  const d = defaultConfig()
  const c = incoming ?? d
  const rois: Roi[] = Array.isArray(c.motion?.rois)
    ? c.motion.rois
        .slice(0, MAX_ROIS)
        .map((r) => {
          const x = Math.min(1, Math.max(0, Number(r?.[0]) || 0))
          const y = Math.min(1, Math.max(0, Number(r?.[1]) || 0))
          const w = Math.min(1 - x, Math.max(0.001, Number(r?.[2]) || 0))
          const h = Math.min(1 - y, Math.max(0.001, Number(r?.[3]) || 0))
          return [x, y, w, h] as Roi
        })
        .filter((r) => r[2] > 0 && r[3] > 0)
    : []
  const rules: ScheduleRule[] = Array.isArray(c.schedules?.rules)
    ? c.schedules.rules.slice(0, 16).map((r) => ({
        days: Array.isArray(r?.days) ? r.days.filter((x) => x >= 1 && x <= 7) : [],
        start: HHMM.test(r?.start) ? r.start : '00:00',
        end: HHMM.test(r?.end) ? r.end : '00:00',
        motion: !!r?.motion,
        record: !!r?.record,
      }))
    : []
  return {
    camera: {
      name: String(c.camera?.name ?? d.camera.name),
      type: String(c.camera?.type ?? d.camera.type),
      rtsp: String(c.camera?.rtsp ?? ''),
      sub_rtsp: String(c.camera?.sub_rtsp ?? ''),
      file: String(c.camera?.file ?? ''),
      dshow_device: String(c.camera?.dshow_device ?? ''),
      width: clampInt(c.camera?.width, 64, 7680, d.camera.width),
      height: clampInt(c.camera?.height, 64, 4320, d.camera.height),
      fps: clampInt(c.camera?.fps, 1, 120, d.camera.fps),
      reconnect_delay_sec: clampInt(c.camera?.reconnect_delay_sec, 1, 60, d.camera.reconnect_delay_sec),
      url: String(c.camera?.url ?? ''),
      preview_quality: clampInt(c.camera?.preview_quality, 1, 100, d.camera.preview_quality),
      preview_fps: clampInt(c.camera?.preview_fps, 1, 30, d.camera.preview_fps),
    },
    motion: {
      enabled: !!c.motion?.enabled,
      threshold: clampInt(c.motion?.threshold, 1, 255, d.motion.threshold),
      min_area: clampInt(c.motion?.min_area, 1, 1_000_000, d.motion.min_area),
      cooldown_sec: clampInt(c.motion?.cooldown_sec, 1, 3600, d.motion.cooldown_sec),
      downscale_width: clampInt(c.motion?.downscale_width, 64, 1920, d.motion.downscale_width),
      rois,
    },
    record: {
      enabled: !!c.record?.enabled,
      dir: String(c.record?.dir ?? d.record.dir),
      segment_seconds: clampInt(c.record?.segment_seconds, 10, 86400, d.record.segment_seconds),
      retention_days: clampInt(c.record?.retention_days, 1, 3650, d.record.retention_days),
      max_disk_gb: clampInt(c.record?.max_disk_gb, 1, 100000, d.record.max_disk_gb),
      encode_crf: clampInt(c.record?.encode_crf, 0, 51, d.record.encode_crf),
    },
    notify: {
      cooldown_sec: clampInt(c.notify?.cooldown_sec, 10, 3600, d.notify.cooldown_sec),
      dingtalk: {
        enabled: !!c.notify?.dingtalk?.enabled,
        webhook: String(c.notify?.dingtalk?.webhook ?? ''),
        secret: String(c.notify?.dingtalk?.secret ?? ''),
      },
      wecom: {
        enabled: !!c.notify?.wecom?.enabled,
        webhook: String(c.notify?.wecom?.webhook ?? ''),
      },
      telegram: {
        enabled: !!c.notify?.telegram?.enabled,
        bot_token: String(c.notify?.telegram?.bot_token ?? ''),
        chat_id: String(c.notify?.telegram?.chat_id ?? ''),
      },
      bark: {
        enabled: !!c.notify?.bark?.enabled,
        server: String(c.notify?.bark?.server ?? d.notify.bark.server),
        device_key: String(c.notify?.bark?.device_key ?? ''),
      },
      webhook: {
        enabled: !!c.notify?.webhook?.enabled,
        url: String(c.notify?.webhook?.url ?? ''),
        secret: String(c.notify?.webhook?.secret ?? ''),
      },
    },
    schedules: { rules },
    selfcheck: {
      enabled: !!c.selfcheck?.enabled,
      interval_sec: clampInt(c.selfcheck?.interval_sec, 60, 3600, d.selfcheck.interval_sec),
      frozen_checks: clampInt(c.selfcheck?.frozen_checks, 1, 60, d.selfcheck.frozen_checks),
      change_threshold: clampInt(c.selfcheck?.change_threshold, 1, 255, d.selfcheck.change_threshold),
      change_checks: clampInt(c.selfcheck?.change_checks, 1, 60, d.selfcheck.change_checks),
    },
    digest: {
      enabled: !!c.digest?.enabled,
      time: HHMM.test(c.digest?.time) ? c.digest.time : d.digest.time,
    },
    bot: {
      enabled: !!c.bot?.enabled,
      bot_token: String(c.bot?.bot_token ?? ''),
      allowed_users: Array.isArray(c.bot?.allowed_users)
        ? c.bot.allowed_users.map((u) => String(u).trim()).filter((u) => /^\d+$/.test(u))
        : [],
    },
  }
}

// ---------------------------------------------------------------------------
// 路由分发
// ---------------------------------------------------------------------------

function parseIso(v: string | null): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

function handleEvents(q: URLSearchParams): EventsResponse {
  const limit = clampInt(q.get('limit') ?? 20, 1, 500, 20)
  const offset = clampInt(q.get('offset') ?? 0, 0, 1_000_000, 0)
  const type = q.get('type') ?? ''
  const detail = q.get('detail') ?? ''
  const from = parseIso(q.get('from'))
  const to = parseIso(q.get('to'))
  let list = events.slice().sort((a, b) => (a.time > b.time ? -1 : a.time < b.time ? 1 : 0))
  if (type === 'motion' || type === 'selfcheck') list = list.filter((e) => e.type === type)
  // v1.2 §3.3：detail 精确筛选（仅 selfcheck 事件携带 frozen|occlusion）
  if (detail === 'frozen' || detail === 'occlusion') list = list.filter((e) => e.detail === detail)
  if (from !== null) list = list.filter((e) => new Date(e.time).getTime() >= from)
  if (to !== null) list = list.filter((e) => new Date(e.time).getTime() <= to)
  return { items: list.slice(offset, offset + limit), total: list.length }
}

function handleNotifyTest(body: unknown): NotifyTestResponse {
  const channel = String((body as { channel?: string } | undefined)?.channel ?? '')
  const enabled: string[] = []
  if (config.notify.dingtalk.enabled) enabled.push('dingtalk')
  if (config.notify.wecom.enabled) enabled.push('wecom')
  if (config.notify.telegram.enabled) enabled.push('telegram')
  if (config.notify.bark.enabled) enabled.push('bark')
  if (config.notify.webhook.enabled) enabled.push('webhook')
  const targets = channel ? [channel] : enabled
  const results = targets.map((ch) => {
    const conf = config.notify[ch as keyof typeof config.notify] as
      | { enabled?: boolean; webhook?: string; url?: string; bot_token?: string; device_key?: string }
      | undefined
    if (!conf || !conf.enabled) {
      return { channel: ch, ok: false, error: '该通道未启用' }
    }
    const missing =
      (ch === 'dingtalk' && !conf.webhook) ||
      (ch === 'wecom' && !conf.webhook) ||
      (ch === 'telegram' && (!conf.bot_token || !(config.notify.telegram as { chat_id?: string }).chat_id)) ||
      (ch === 'bark' && !conf.device_key) ||
      (ch === 'webhook' && !conf.url)
    return missing
      ? { channel: ch, ok: false, error: '必填项未配置完整' }
      : { channel: ch, ok: true, error: '' }
  })
  return { results }
}

/** mock 专用：生成一条日志（供 logStream.ts 复用）。消息里不留 %d/%s 占位符，避免看起来像渲染 bug */
export function mockLogEntry(seq: number, secondsAgo = 0): LogEntry {
  const rnd = mulberry32(seq * 2654435761 + 7)
  const pick = (arr: string[]) => arr[Math.floor(rnd() * arr.length)]
  const roll = rnd()
  const level = roll < 0.6 ? 'INFO' : roll < 0.82 ? 'DEBUG' : roll < 0.95 ? 'WARN' : 'ERROR'

  const score = 300 + Math.floor(rnd() * 1200)
  const area = 200 + Math.floor(rnd() * 1400)
  const n = 1 + Math.floor(rnd() * 400)
  const segName = `2026-09-28_${pad(8 + Math.floor(rnd() * 14))}-${pad(Math.floor(rnd() * 60))}-00.mp4`
  const ms = (0.4 + rnd() * 9).toFixed(1)
  const disk = (62 + rnd() * 22).toFixed(1)

  let msg: string
  if (level === 'ERROR') {
    msg = pick([
      'notify: telegram send failed: Post "https://api.telegram.org/bot***/sendMessage": dial tcp 149.154.167.220:443: i/o timeout',
      `recorder: encode segment ${segName} error: exit status 1 (retrying in 3s)`,
      'notify: webhook send failed: HTTP 502 Bad Gateway',
    ])
  } else if (level === 'WARN') {
    msg = pick([
      `recorder: disk usage ${disk}% exceeds soft watermark`,
      `camera: frame gap ${(1 + rnd() * 1.5).toFixed(2)}s (> 1.0s)`,
      `store: retention removed ${1 + Math.floor(rnd() * 5)} expired event files`,
      `motion: event suppressed, cooldown ${config.motion.cooldown_sec}s not elapsed`,
    ])
  } else if (level === 'DEBUG') {
    msg = pick([
      `detector: changed=${area * 3} area=${area} roi_hit=${rnd() < 0.5} score=${score}`,
      `pipeline: tick 25ms decode=${(4 + rnd() * 8).toFixed(1)}ms detect=${(2 + rnd() * 4).toFixed(1)}ms`,
      'schedule: active window 08:00-22:00 motion=true record=true',
      `ffmpeg: [synthetic] frame=${n * 25} fps=25 q=-0.0 time=00:0${Math.floor(rnd() * 9)}:${pad(Math.floor(rnd() * 60))}`,
    ])
  } else {
    msg = pick([
      `motion event #${n} stored (score=${score}, image=ev-20260928-${pad(Math.floor(rnd() * 24))}${pad(Math.floor(rnd() * 60))}${pad(Math.floor(rnd() * 60))}-${pad(1 + Math.floor(rnd() * 9), 3)}.jpg)`,
      `recorder: new segment ${segName} started`,
      'selfcheck: state=ok frozen=0 change=0',
      `http: GET /api/status 200 ${ms}ms`,
      'notify: digest scheduled at 22:00',
      'notify: motion event pushed to telegram',
      `store: events_count=${n} total, jsonl rotated by month`,
    ])
  }
  return { time: rfc3339(new Date(Date.now() - secondsAgo * 1000)), level, msg }
}

export async function mockRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  await abortableDelay(90 + Math.random() * 160, signal)

  const [pathname, search = ''] = path.split('?')
  const q = new URLSearchParams(search)
  const ok = (data: unknown): T => data as T

  // --- 状态 ---
  if (method === 'GET' && pathname === '/api/status') return ok(currentStatus())

  // --- 配置 ---
  if (method === 'GET' && pathname === '/api/config') return ok(config)
  if (method === 'POST' && pathname === '/api/config') {
    config = sanitize(body as Config)
    return ok(config)
  }

  // --- 布防 ---
  if (method === 'POST' && pathname === '/api/arm') {
    armed = !!(body as ArmRequest | undefined)?.armed
    const res: ArmResponse = { armed }
    return ok(res)
  }

  // --- 事件 ---
  if (method === 'GET' && pathname === '/api/events') return ok(handleEvents(q))
  if (method === 'POST' && pathname === '/api/events/batch-delete') {
    const ids = new Set(((body as BatchDeleteRequest | undefined)?.ids ?? []).map(Number))
    const before = events.length
    events = events.filter((e) => !ids.has(e.id))
    timelineCache.clear()
    const res: BatchDeleteResponse = { deleted: before - events.length }
    return ok(res)
  }

  // --- 录像 ---
  if (method === 'GET' && pathname === '/api/recordings') {
    const items = recordings.slice().sort((a, b) => (a.name > b.name ? -1 : 1))
    const res: RecordingsResponse = {
      items,
      total_size_bytes: items.reduce((s, r) => s + r.size_bytes, 0),
    }
    return ok(res)
  }
  if (method === 'DELETE' && pathname.startsWith('/api/recordings/')) {
    const name = decodeURIComponent(pathname.slice('/api/recordings/'.length))
    if (!/^[A-Za-z0-9_-]+\.mp4$/.test(name)) {
      throw new ApiError(400, '文件名不合法')
    }
    const idx = recordings.findIndex((r) => r.name === name)
    if (idx < 0) throw new ApiError(404, '录像不存在')
    recordings.splice(idx, 1)
    timelineCache.clear()
    return ok({})
  }

  // --- 时间轴 ---
  if (method === 'GET' && pathname === '/api/timeline') {
    const date = q.get('date') || dateStr(new Date())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'date 参数格式应为 YYYY-MM-DD')
    return ok(buildTimeline(date))
  }

  // --- 通知测试 ---
  if (method === 'POST' && pathname === '/api/notify/test') return ok(handleNotifyTest(body))

  // --- 手动抓拍 ---
  if (method === 'POST' && pathname === '/api/snapshots') {
    const t = new Date()
    const file = `snap-${compactDate(t)}-${compactTime(t)}.jpg`
    const url = `/media/snapshots/manual/${file}`
    manualSnapshots.push(url)
    const res: ManualSnapshotResponse = { file, url }
    return ok(res)
  }

  throw new ApiError(404, `mock 未实现该端点：${method} ${pathname}`)
}

/** 仅测试/调试用：把 mock 状态恢复初始 */
export function __resetMockState(): void {
  armed = true
  config = defaultConfig()
  events = seedEvents()
  recordings = seedRecordings()
  manualSnapshots = []
  timelineCache.clear()
}

export type { ApiResponse }
