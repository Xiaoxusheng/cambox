/**
 * /playback 回看（v1.3 按 camhub-ui-4k/04 设计稿重做）
 * 日期导航 → 24h 时间轴（录像段青条 + 自检黄刻 / 异常红刻 + 播放头）→ 点击跳转播放。
 * 播放器：自定义控制条（播放/进度/倍速/全屏）。跳转规则（契约 §4）：
 * video.currentTime = 事件时间 − 所在录像段 start。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DatePicker, Message } from '@arco-design/web-react'
import { IconLeft, IconRight } from '@arco-design/web-react/icon'
import { fetchStatus, fetchTimeline } from '../api/endpoints'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { Status, TimelineData, TimelineSegment } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import {
  eventTypeLabel,
  formatBytes,
  formatClockLong,
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

type PlaybackData = [TimelineData, Status]

export function PlaybackPage() {
  const today = toLocalDateStr(new Date())
  const [date, setDate] = useState(today)
  const [current, setCurrent] = useState<TimelineSegment | null>(null)
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [seeking, setSeeking] = useState(false)
  const [videoError, setVideoError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const playerBoxRef = useRef<HTMLDivElement>(null)
  const { data, loading, error, reload } = useAsync<PlaybackData>(
    (signal) => Promise.all([fetchTimeline(date, signal), fetchStatus(signal)]),
    [date],
  )

  // 换日期时复位播放器
  useEffect(() => {
    setCurrent(null)
    setPendingSeek(null)
    setPos(0)
    setVideoError(null)
  }, [date])

  useEffect(() => {
    const v = videoRef.current
    if (v) v.playbackRate = rate
  }, [rate, current])

  const segments = data?.[0].segments ?? []
  const events = data?.[0].events ?? []
  const camType = data?.[1].camera.type ?? ''
  const modeLabel = camType === 'rtsp' || camType === 'url' ? '流复制' : camType ? '编码' : ''

  const recordedHours = useMemo(
    () => segments.reduce((acc, s) => acc + durationSec(s.start, s.end), 0) / 3600,
    [segments],
  )

  /**
   * 时间轴渲染块：把相邻（间隙 ≤ 45s）或重叠的录像段合并成一个连续块。
   * 24h 视图下 1px ≈ 66s，几十秒的翻段间隙肉眼不可见，不合并就是一堆毛刺；
   * 合并后是干净的整块，点击播块内对应段。
   */
  const timelineBlocks = useMemo(() => {
    const MERGE_GAP_SEC = 45
    const sorted = [...segments].sort((a, b) => secOfDay(a.start) - secOfDay(b.start))
    const out: { segs: TimelineSegment[]; start: string; end: string }[] = []
    for (const s of sorted) {
      const last = out[out.length - 1]
      if (last && secOfDay(s.start) - secOfDay(last.end) <= MERGE_GAP_SEC) {
        last.segs.push(s)
        if (secOfDay(s.end) > secOfDay(last.end)) last.end = s.end
      } else {
        out.push({ segs: [s], start: s.start, end: s.end })
      }
    }
    return out
  }, [segments])

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
    v.playbackRate = rate
    void v.play().catch(() => undefined)
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v || !current) return
    const r = e.currentTarget.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : durationSec(current.start, current.end)
    const t = pct * dur
    v.currentTime = t
    setPos(t)
  }

  const fullscreen = () => {
    const el = playerBoxRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => Message.error('当前浏览器不允许全屏'))
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
  const segDuration = current ? durationSec(current.start, current.end) : 0

  return (
    <>
      <PageHeader title="回看" description="点击时间轴上的事件刻度，跳转到该时刻播放" />

      <div className="ch-datebar">
        <button
          type="button"
          className="ch-datebtn"
          aria-label="前一天"
          onClick={() => setDate((d) => shiftDate(d, -1))}
        >
          <IconLeft />
        </button>
        <span className="ch-datepill">
          <DatePicker
            value={date}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(v) => setDate(String(v))}
          />
          {date === today ? <span className="ch-datepill-today num">· 今天</span> : null}
        </span>
        <button
          type="button"
          className="ch-datebtn"
          aria-label="后一天"
          disabled={date >= today}
          onClick={() => setDate((d) => shiftDate(d, 1))}
        >
          <IconRight />
        </button>
        {date !== today ? (
          <button type="button" className="ch-btn sm" onClick={() => setDate(today)}>
            回到今天
          </button>
        ) : null}
        <span className="ch-filterbar-spacer" />
        <span className="ch-muted">
          已录制 <span className="num">{recordedHours.toFixed(1)}h</span> ·{' '}
          <span className="num">{segments.length}</span> 段
          {modeLabel ? ` · ${modeLabel}` : ''}
        </span>
      </div>

      <section className="ch-panel ch-gap-md">
        <header className="ch-panel-head">
          <div className="ch-panel-title">今日时间轴</div>
          <div className="ch-panel-extra ch-legend">
            <span>
              <i style={{ background: 'var(--ch-primary)' }} />
              录像段
            </span>
            <span>
              <i style={{ background: 'var(--ch-warn)' }} />
              自检事件
            </span>
            <span>
              <i style={{ background: 'var(--ch-danger)' }} />
              异常
            </span>
          </div>
        </header>
        <div className="ch-panel-body">
          {segments.length === 0 && events.length === 0 ? (
            <EmptyState
              title={`${date} 没有录像与事件`}
              description="可能当天未开启录像，或录像已被保留策略清理。"
            />
          ) : (
            <div className="ch-timeline">
              <div className="ch-timeline-track" />
              {Array.from({ length: 25 }, (_, i) => (
                <div
                  key={i}
                  className={`ch-timeline-hour ${i % 4 === 0 ? 'major' : ''}`}
                  style={{ left: `${(i / 24) * 100}%` }}
                />
              ))}
              {Array.from({ length: 7 }, (_, i) => (
                <span
                  key={i}
                  className="ch-timeline-hour-label"
                  style={{
                    left: `${((i * 4) / 24) * 100}%`,
                    // 首尾标签贴边对齐，避免被面板裁掉一半
                    transform:
                      i === 0 ? 'translateX(0)' : i === 6 ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}
                >
                  {String(i * 4).padStart(2, '0')}:00
                </span>
              ))}

              {timelineBlocks.map((b) => {
                const left = (secOfDay(b.start) / 86400) * 100
                const width = Math.max(0.2, ((secOfDay(b.end) - secOfDay(b.start)) / 86400) * 100)
                const isCurrent = current !== null && b.segs.some((s) => s.name === current.name)
                const target =
                  current !== null && b.segs.some((s) => s.name === current.name)
                    ? current
                    : b.segs[0]
                const sizeBytes = b.segs.reduce((acc, s) => acc + s.size_bytes, 0)
                const title =
                  b.segs.length === 1
                    ? `${b.segs[0].name}\n${formatTime(b.start)} – ${formatTime(b.end)}（${formatBytes(b.segs[0].size_bytes)}）`
                    : `${b.segs.length} 段连续录像\n${formatTime(b.start)} – ${formatTime(b.end)}（共 ${formatBytes(sizeBytes)}）`
                return (
                  <div
                    key={b.segs[0].name}
                    className={`ch-timeline-seg ${isCurrent ? 'current' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={title}
                    role="button"
                    tabIndex={0}
                    aria-label={`播放录像段 ${target.name}`}
                    onClick={() => {
                      setCurrent(target)
                      setPendingSeek(0)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setCurrent(target)
                        setPendingSeek(0)
                      }
                    }}
                  />
                )
              })}

              {events.map((e) => (
                <div
                  key={e.id}
                  className={`ch-timeline-event ${e.type === 'motion' ? 'motion' : e.detail === 'occlusion' ? 'selfcheck-occlusion' : 'selfcheck-frozen'}`}
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
                <div className="ch-timeline-playhead" style={{ left: `${playheadPct}%` }}>
                  <span className="ch-timeline-playhead-tag num">{formatTime(absoluteTime).slice(0, 5)}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="ch-panel">
        <div className="ch-panel-body">
          <div className="ch-player-box" ref={playerBoxRef}>
            {current && src ? (
              <>
                <video
                  ref={videoRef}
                  src={src}
                  preload="metadata"
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={(e) => {
                    if (!seeking) setPos(e.currentTarget.currentTime)
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onError={() => setVideoError(`无法播放 ${current.name}（分段可能损坏或缺 moov）`)}
                />
                <span className="ch-ovl tl num">
                  回放 · {current.name} · {absoluteTime ? formatTime(absoluteTime) : ''}
                </span>
              </>
            ) : (
              <div
                style={{
                  aspectRatio: '16 / 9',
                  maxHeight: '56vh',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: 'var(--ch-text-3)',
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
            <div className="ch-note danger" style={{ marginTop: 12 }}>
              {videoError}
            </div>
          ) : null}

          <div className="ch-player-bar">
            <button
              type="button"
              className="ch-playbtn"
              onClick={togglePlay}
              disabled={!current || !src}
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="ch-playtime num">
              {formatClockLong(pos)} / {formatClockLong(segDuration)}
            </span>
            <div
              className="ch-seek"
              role="slider"
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={Math.round(segDuration)}
              aria-valuenow={Math.round(pos)}
              tabIndex={0}
              onPointerDown={(e) => {
                if (!current) return
                e.currentTarget.setPointerCapture(e.pointerId)
                setSeeking(true)
                seekFromEvent(e)
              }}
              onPointerMove={(e) => {
                if (seeking) seekFromEvent(e)
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
                setSeeking(false)
              }}
              onPointerCancel={() => setSeeking(false)}
            >
              <div className="ch-seek-track">
                <div
                  className="ch-seek-fill"
                  style={{ width: `${segDuration > 0 ? Math.min(100, (pos / segDuration) * 100) : 0}%` }}
                />
              </div>
              <span
                className="ch-seek-knob"
                style={{
                  left: `${segDuration > 0 ? Math.min(100, (pos / segDuration) * 100) : 0}%`,
                  opacity: current ? 1 : 0,
                }}
              />
            </div>
            <div className="ch-speedgroup">
              {[0.5, 1, 2].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`ch-speedbtn ${rate === r ? 'active' : ''}`}
                  onClick={() => setRate(r)}
                >
                  {r}x
                </button>
              ))}
            </div>
            <button type="button" className="ch-btn sm" onClick={fullscreen}>
              全屏
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
