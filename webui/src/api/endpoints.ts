/**
 * 端点封装 —— 页面只调用这里的函数，禁止各自拼 URL。
 * 每个函数与 docs/contracts/api-v1.1.md §3 一一对应。
 */
import { apiDelete, apiGet, apiPost } from './client'
import type {
  ArmResponse,
  BatchDeleteResponse,
  Config,
  EventsQuery,
  EventsResponse,
  ManualSnapshotResponse,
  NotifyTestResponse,
  RecordingsResponse,
  Status,
  TimelineData,
} from './types'

// ---- 状态 / 布防 ----

export function fetchStatus(signal?: AbortSignal): Promise<Status> {
  return apiGet<Status>('/api/status', { signal })
}

export function setArmed(armed: boolean): Promise<ArmResponse> {
  return apiPost<ArmResponse>('/api/arm', { armed })
}

// ---- 配置 ----

export function fetchConfig(signal?: AbortSignal): Promise<Config> {
  return apiGet<Config>('/api/config', { signal })
}

/** 全量保存（契约 §3.2：请求体即 GET /api/config 的完整 data） */
export function saveConfig(config: Config): Promise<Config> {
  return apiPost<Config>('/api/config', config)
}

// ---- 事件 ----

export function fetchEvents(q: EventsQuery, signal?: AbortSignal): Promise<EventsResponse> {
  const p = new URLSearchParams()
  if (q.limit != null) p.set('limit', String(q.limit))
  if (q.offset != null) p.set('offset', String(q.offset))
  if (q.type) p.set('type', q.type)
  if (q.from) p.set('from', q.from)
  if (q.to) p.set('to', q.to)
  return apiGet<EventsResponse>(`/api/events?${p.toString()}`, { signal })
}

export function batchDeleteEvents(ids: number[]): Promise<BatchDeleteResponse> {
  return apiPost<BatchDeleteResponse>('/api/events/batch-delete', { ids })
}

// ---- 录像 ----

export function fetchRecordings(signal?: AbortSignal): Promise<RecordingsResponse> {
  return apiGet<RecordingsResponse>('/api/recordings', { signal })
}

export function deleteRecording(name: string): Promise<Record<string, never>> {
  return apiDelete<Record<string, never>>(`/api/recordings/${encodeURIComponent(name)}`)
}

// ---- 时间轴 ----

export function fetchTimeline(date: string, signal?: AbortSignal): Promise<TimelineData> {
  return apiGet<TimelineData>(`/api/timeline?date=${encodeURIComponent(date)}`, { signal })
}

// ---- 通知测试 / 抓拍 ----

export function testNotify(channel: string): Promise<NotifyTestResponse> {
  return apiPost<NotifyTestResponse>('/api/notify/test', { channel })
}

export function manualSnapshot(): Promise<ManualSnapshotResponse> {
  return apiPost<ManualSnapshotResponse>('/api/snapshots')
}
