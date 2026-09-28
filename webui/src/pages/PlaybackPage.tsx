/**
 * /playback 回放
 * 日期选择（默认今天）→ 24h 时间轴（录像段蓝条 + 事件刻度）→ 点击刻度跳转到该时刻。
 * 跳转规则（契约 §4）：video.currentTime = 事件时间 − 所在录像段 start。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Message, Tag } from '@arco-design/web-react'
import { IconLeft, IconPlayCircle, IconRight } from '@arco-design/web-react/icon'
import { fetchTimeline } from '../api/endpoints'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { TimelineData, TimelineSegment } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import {
  eventTypeLabel,
  formatBytes,
  formatClockDuration,
  formatTime,
  toLocalDateStr,
} from '../utils/format'

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toLocalDateStr(d)
}

/** 一天内的秒偏移（0~86400），用于时间轴定位 */
function secOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000
}

function durationSec(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000)
}

export function PlaybackPage() {
  const today = toLocalDateStr(new Date())
  const [date, setDate] = useState(today)
  const [current, setCurrent] = useState<TimelineSegment | null>(null)
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)
  const [pos, setPos] = useState(0)
  const [videoError, setVideoError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const { data, loading, error, reload } = useAsync<TimelineData>(
    (signal) => fetchTimeline(date, signal),
    [date],
  )

  // 换日期时复位播放器
  useEffect(() => {
    setCurrent(null)
    setPendingSeek(null)
    setPos(0)
    setVideoError(null)
  }, [date])

  const segments = data?.segments ?? []

  /** 找到包含该时刻的录像段（无则取之后最近的一段） */
  const locate = (iso: string): { seg: TimelineSegment; offset: number } | null => {
    if (segments.length === 0) return null
    const t = new Date(iso).getTime()
    const hit = segments.find(
      (s) => t >= new Date(s.start).getTime() && t <= new Date(s.end).getTime(),
    )
    if (hit) return { seg: hit, offset: (t - new Date(hit.start).getTime()) / 1000 }
    const next = segments.find((s) => new Date(s.start).getTime() > t)
    if (next) return { seg: next, offset: 0 }
    const last = segments[segments.length - 1]
    return { seg: last, offset: 0 }
  }

  const playAt = (iso: string) => {
    const found = locate(iso)
    if (!found) {
      Message.warning('当日没有录像，无法跳转播放')
      return
    }
    const { seg, offset } = found
    if (current?.name === seg.name && videoRef.current) {
      videoRef.current.currentTime = offset
      void videoRef.current.play().catch(() => undefined)
    } else {
      setCurrent(seg)
      setPendingSeek(offset)
    }
  }

  const onLoadedMetadata = () => {
    const v = videoRef.current
    if (!v) return
    if (pendingSeek != null) {
      v.currentTime = Math.min(pendingSeek, Math.max(0, v.duration - 0.2))
      setPendingSeek(null)
    }
    void v.play().catch(() => undefined)
  }

  const src = current ? recordingUrl(current.name) : null

  const playheadPct = useMemo(() => {
    if (!current) return null
    const startSec = secOfDay(current.start)
    return ((startSec + pos) / 86400) * 100
  }, [current, pos])

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const absoluteTime = current
    ? new Date(new Date(current.start).getTime() + pos * 1000).toISOString()
    : null

  return (
    <>
      <PageHeader
        title="回放"
        description="选择日期查看当日录像分段与事件刻度，点击刻度跳转到对应时刻。"
        actions={
          <>
            <Button
              icon={<IconLeft />}
              aria-label="前一天"
              onClick={() => setDate((d) => shiftDate(d, -1))}
            />
            <DatePicker
              value={date}
              format="YYYY-MM-DD"
              allowClear={false}
              onChange={(v) => setDate(String(v))}
              style={{ width: 148 }}
            />
            <Button
              icon={<IconRight />}
              aria-label="后一天"
              disabled={date >= today}
              onClick={() => setDate((d) => shiftDate(d, 1))}
            />
            <Button disabled={date === today} onClick={() => setDate(today)}>
              今天
            </Button>
          </>
        }
      />

      <Panel
        title="24 小时时间轴"
        extra={
          <span className="ch-muted num">
            录像 {segments.length} 段 · 事件 {data.events.length} 条
          </span>
        }
        style={{ marginBottom: 'var(--ch-space-md)' }}
      >
        {segments.length === 0 && data.events.length === 0 ? (
          <EmptyState
            title={`${data.date} 没有录像与事件`}
            description="可能当天未开启录像，或录像已被保留策略清理。"
          />
        ) : (
          <>
            <div className="ch-timeline">
              {Array.from({ length: 25 }, (_, i) => (
                <div
                  key={i}
                  className={`ch-timeline-hour ${i % 6 === 0 ? 'major' : ''}`}
                  style={{ left: `${(i / 24) * 100}%` }}
                />
              ))}
              {Array.from({ length: 9 }, (_, i) => (
                <span
                  key={i}
                  className="ch-timeline-hour-label num"
                  style={{
                    left: `${((i * 3) / 24) * 100}%`,
                    // 首尾标签贴边对齐，否则会被面板 overflow:hidden 裁掉一半
                    transform:
                      i === 0 ? 'translateX(0)' : i === 8 ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}
                >
                  {String(i * 3).padStart(2, '0')}:00
                </span>
              ))}

              {segments.map((s) => {
                const left = (secOfDay(s.start) / 86400) * 100
                const width = Math.max(0.15, (durationSec(s.start, s.end) / 86400) * 100)
                return (
                  <div
                    key={s.name}
                    className={`ch-timeline-seg ${current?.name === s.name ? 'current' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${s.name}\n${formatTime(s.start)} – ${formatTime(s.end)}（${formatBytes(s.size_bytes)}）`}
                    onClick={() => {
                      setCurrent(s)
                      setPendingSeek(0)
                    }}
                  />
                )
              })}

              {data.events.map((e) => (
                <div
                  key={e.id}
                  className={`ch-timeline-event ${e.type}`}
                  style={{ left: `${(secOfDay(e.time) / 86400) * 100}%` }}
                  title={`${formatTime(e.time)} ${eventTypeLabel(e.type, e.detail)}${
                    e.type === 'motion' ? `（得分 ${e.score}）` : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-label={`跳转到 ${formatTime(e.time)} 的${eventTypeLabel(e.type, e.detail)}`}
                  onClick={() => playAt(e.time)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      playAt(e.time)
                    }
                  }}
                />
              ))}

              {playheadPct != null ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${playheadPct}%`,
                    width: 2,
                    background: 'var(--ch-danger)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </div>

            <div
              className="ch-muted"
              style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}
            >
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 8,
                    background: 'var(--ch-primary)',
                    borderRadius: 2,
                    marginRight: 6,
                  }}
                />
                录像段
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 4,
                    height: 10,
                    background: 'var(--ch-primary)',
                    marginRight: 6,
                  }}
                />
                移动侦测
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 4,
                    height: 10,
                    background: 'var(--ch-warn)',
                    marginRight: 6,
                  }}
                />
                画面异常 / 冻结
              </span>
            </div>
          </>
        )}
      </Panel>

      <div className="ch-split">
        <Panel
          title="播放器"
          extra={
            current ? (
              <span className="ch-muted num">
                {current.name} · {formatClockDuration(pos)} / {formatClockDuration(durationSec(current.start, current.end))}
                {absoluteTime ? ` · 画面时刻 ${formatTime(absoluteTime)}` : ''}
              </span>
            ) : (
              <span className="ch-muted">未选择录像</span>
            )
          }
          bodyStyle={{ padding: 0 }}
        >
          <div className="ch-player-box">
            {current && src ? (
              <video
                ref={videoRef}
                src={src}
                controls
                preload="metadata"
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
                onError={() => setVideoError(`无法播放 ${current.name}`)}
                style={{ aspectRatio: '16 / 9' }}
              />
            ) : (
              <div
                style={{
                  aspectRatio: '16 / 9',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: 'var(--color-text-3)',
                  fontSize: 13,
                  textAlign: 'center',
                  padding: 16,
                }}
              >
                {IS_MOCK ? (
                  <>
                    <span>mock 模式没有真实 mp4 视频源</span>
                    <span style={{ fontSize: 12 }}>
                      时间轴、跳转与分段选择逻辑可正常自查；播放需连接后端（VITE_API_MODE=real）。
                    </span>
                  </>
                ) : (
                  <span>点击时间轴上的录像段或事件刻度开始播放</span>
                )}
              </div>
            )}
          </div>
          {videoError ? (
            <div className="ch-note danger" style={{ margin: 'var(--ch-space-md)' }}>
              {videoError}
            </div>
          ) : null}
        </Panel>

        <Panel title="当日录像段" extra={<span className="ch-muted num">{segments.length}</span>}>
          {segments.length === 0 ? (
            <EmptyState title="当日无录像" description="请确认录像已开启，或换一个日期查看。" />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 420,
                overflow: 'auto',
              }}
            >
              {segments.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="ch-roi-item"
                  style={{
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: current?.name === s.name ? 'var(--ch-primary)' : 'var(--color-text-1)',
                    borderColor:
                      current?.name === s.name ? 'var(--ch-primary)' : 'var(--color-border-2)',
                  }}
                  onClick={() => {
                    setCurrent(s)
                    setPendingSeek(0)
                  }}
                >
                  <IconPlayCircle />
                  <span className="num" style={{ flex: 1 }}>
                    {formatTime(s.start)} – {formatTime(s.end)}
                  </span>
                  <Tag size="small">{formatBytes(s.size_bytes)}</Tag>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
