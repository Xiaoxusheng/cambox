/**
 * camhub API v1.1 类型定义 —— 与 docs/contracts/api-v1.1.md 字段一一对应
 * 修改类型前先改契约文件。
 */

// ---- 统一响应 ----

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

// ---- GET /api/status（v1.0 基础 + v1.1 新增 armed / schedule_active / selfcheck） ----

export interface CameraStatus {
  name: string
  type: string
  connected: boolean
  fps: number
  width: number
  height: number
  restarts: number
  last_error?: string
}

export interface RecorderStatus {
  enabled: boolean
  running: boolean
  mode: string
  current_file: string
  last_error?: string
}

export interface MotionStatus {
  enabled: boolean
}

export interface DiskStatus {
  recordings_bytes: number
  snapshots_bytes: number
  max_gb: number
}

export type SelfCheckState = 'ok' | 'frozen' | 'occlusion'

export interface SelfCheckStatus {
  enabled: boolean
  last_run: string | null
  state: SelfCheckState
  last_alert: string
  consecutive_frozen: number
  consecutive_change: number
}

export interface ScheduleActive {
  motion: boolean
  record: boolean
}

export interface Status {
  time: string
  uptime_sec: number
  camera: CameraStatus
  recorder: RecorderStatus
  motion: MotionStatus
  disk: DiskStatus
  events_count: number
  ffmpeg_log: string[]
  armed: boolean
  schedule_active: ScheduleActive
  selfcheck: SelfCheckStatus
}

// ---- 事件 ----

export type EventType = 'motion' | 'selfcheck'

export interface Event {
  id: number
  time: string
  type: EventType
  score: number
  image: string
  /** v1.1 新增可选：selfcheck 事件的 frozen | occlusion */
  detail?: string
}

export interface EventsResponse {
  items: Event[]
  total: number
}

export interface EventsQuery {
  limit?: number
  offset?: number
  type?: EventType | ''
  /** v1.2 §3.3：精确筛选画面自检的冻结/异常 */
  detail?: 'frozen' | 'occlusion' | ''
  from?: string
  to?: string
}

// ---- 录像 ----

export interface RecordFile {
  name: string
  size_bytes: number
  modified: string
  /** v1.1 新增：由文件名解析，解析失败为 null */
  start: string | null
  end: string | null
}

export interface RecordingsResponse {
  items: RecordFile[]
  total_size_bytes: number
}

// ---- 配置（v1.1 全量） ----

export interface CameraConfig {
  name: string
  /** v1.2 新增 'url'：任意网络流（HTTP-FLV / HLS / RTMP），如直播拉流地址 */
  type: 'synthetic' | 'rtsp' | 'file' | 'dshow' | 'url' | string
  rtsp: string
  sub_rtsp: string
  file: string
  dshow_device: string
  /** v1.2：type=url 时的流地址 */
  url: string
  width: number
  height: number
  fps: number
  reconnect_delay_sec: number
  /** v1.2：MJPEG 与抓拍的 JPEG 质量 1~100（热更新即时生效） */
  preview_quality: number
  /** v1.2：MJPEG 推送帧率上限 1~30（热更新即时生效）。注意这是预览帧率，不是录像帧率 */
  preview_fps: number
}

/** 归一化矩形 [x, y, w, h]，值域 0~1 */
export type Roi = [number, number, number, number]

export interface MotionConfig {
  enabled: boolean
  threshold: number
  min_area: number
  cooldown_sec: number
  downscale_width: number
  rois: Roi[]
}

export interface RecordConfig {
  enabled: boolean
  dir: string
  segment_seconds: number
  retention_days: number
  max_disk_gb: number
  /**
   * v1.2：非 copy 模式（synthetic/file/dshow）录像的 libx264 CRF，0~51，越小越清晰越大。
   * rtsp/url 源走 -c copy 原始码流，此值无效。
   */
  encode_crf: number
}

export interface NotifyDingTalk {
  enabled: boolean
  webhook: string
  secret: string
}

export interface NotifyWecom {
  enabled: boolean
  webhook: string
}

export interface NotifyTelegram {
  enabled: boolean
  bot_token: string
  chat_id: string
}

export interface NotifyBark {
  enabled: boolean
  server: string
  device_key: string
}

export interface NotifyWebhook {
  enabled: boolean
  url: string
  secret: string
}

export interface NotifyConfig {
  cooldown_sec: number
  dingtalk: NotifyDingTalk
  wecom: NotifyWecom
  telegram: NotifyTelegram
  bark: NotifyBark
  webhook: NotifyWebhook
}

/** days: 1=周一 ... 7=周日；start==end 全天；end<start 跨零点 */
export interface ScheduleRule {
  days: number[]
  start: string
  end: string
  motion: boolean
  record: boolean
}

export interface SchedulesConfig {
  rules: ScheduleRule[]
}

export interface SelfCheckConfig {
  enabled: boolean
  interval_sec: number
  frozen_checks: number
  change_threshold: number
  change_checks: number
}

export interface DigestConfig {
  enabled: boolean
  time: string
}

export interface BotConfig {
  enabled: boolean
  bot_token: string
  allowed_users: string[]
}

export interface Config {
  camera: CameraConfig
  motion: MotionConfig
  record: RecordConfig
  notify: NotifyConfig
  schedules: SchedulesConfig
  selfcheck: SelfCheckConfig
  digest: DigestConfig
  bot: BotConfig
}

// ---- 时间轴 ----

export interface TimelineSegment {
  name: string
  start: string
  end: string
  size_bytes: number
}

export interface TimelineData {
  date: string
  segments: TimelineSegment[]
  events: Event[]
  /** 当日每小时事件数，长度恒 24 */
  hourly: number[]
}

// ---- 其余端点 ----

export interface ArmRequest {
  armed: boolean
}

export interface ArmResponse {
  armed: boolean
}

export interface BatchDeleteRequest {
  ids: number[]
}

export interface BatchDeleteResponse {
  deleted: number
}

export interface NotifyTestRequest {
  channel: string
}

export interface NotifyTestResult {
  channel: string
  ok: boolean
  error: string
}

export interface NotifyTestResponse {
  results: NotifyTestResult[]
}

export interface ManualSnapshotResponse {
  file: string
  url: string
}

export interface LogEntry {
  time: string
  level: string
  msg: string
}
