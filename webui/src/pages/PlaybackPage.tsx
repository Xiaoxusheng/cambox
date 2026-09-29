/**
 * /playback 回看 —— camhub v1.3 重设计（Phase 4）。
 * 布局（设计稿 04-回看 + 任务书 §22~25）：日期胶囊导航 → 时间轴面板（录像段实心带 + 事件刻度 + 播放头）→ 播放器面板（contain 画面 + HUD 标签 + 自绘控制条：播放/时间/进度/倍速/全屏）。
 * 跳转规则（契约 §4）不变：video.currentTime = 事件时间 − 所在录像段 start。
 * 合并/聚合算法原样保留（30min 合并、0.35% 聚合）；时间轴皮肤 ch-timeline-* → cam-tl-*。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, DatePicker, Message, Radio, Slider } from '@arco-design/web-react'
import { IconLeft, IconPause, IconPlayArrowFill, IconRight } from '@arco-design/web-react/icon'
import { fetchStatus, fetchTimeline } from '../api/endpoints'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { Event, Status, TimelineData, TimelineSegment } from '../api/types'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { IconButton } from '../components/common/IconButton'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/common/Panel'
import { useAsync } from '../hooks/useAsync'
import { cx } from '../utils/cx'
import { eventTypeLabel, formatBytes, formatClockLong, formatTime, toLocalDateStr } from '../utils/format'

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

/** 时间轴图例色块（录像段=accent 实心带；刻度=中性/警告/危险） */
function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-cam-text-tertiary">
      <i className={cx('inline-block', className)} />
      {label}
    </span>
  )
}

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
   * 时间轴渲染块：把相邻（间隙 ≤ 30 分钟）或重叠的录像段合并成一个连续块，
   * 录像覆盖期呈现为一条填满的实心带；翻段间隙、短暂停录都不可见。
   * 超过 30 分钟的空档（真的长时间停录）才会断开。算法原样保留（v1.3 仅皮肤重绘）。
   */
  const timelineBlocks = useMemo(() => {
    const MERGE_GAP_SEC = 1800
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

  /**
   * 事件刻度聚合：同类事件落点间距 ≤ 0.35% 视宽（约 5 分钟）时并成一根刻度。
   * 一天几千条 motion 事件若逐条渲染，会把时间轴糊成实心带还拖垮 DOM。算法原样保留。
   */
  const eventTicks = useMemo(() => {
    const MIN_GAP_PCT = 0.35
    const kindOf = (e: Event) =>
      e.type === 'motion' ? 'motion' : e.detail === 'occlusion' ? 'selfcheck-occlusion' : 'selfcheck-frozen'
    const sorted = [...events].sort((a, b) => secOfDay(a.time) - secOfDay(b.time))
    const out: { leftPct: number; endPct: number; kind: string; count: number; first: Event; last: Event }[] = []
    for (const e of sorted) {
      const pct = (secOfDay(e.time) / 86400) * 100
      const kind = kindOf(e)
      const last = out[out.length - 1]
      if (last && last.kind === kind && pct - last.endPct <= MIN_GAP_PCT) {
        last.endPct = pct
        last.count += 1
        last.last = e
      } else {
        out.push({ leftPct: pct, endPct: pct, kind, count: 1, first: e, last: e })
      }
    }
    return out
  }, [events])

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

  const seekTo = (t: number) => {
    const v = videoRef.current
    if (!v || !current) return
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
  const timelineEmpty = segments.length === 0 && events.length === 0

  return (
    <>
      <PageHeader title="回看" description="点击时间轴上的事件刻度或录像段，跳转到该时刻播放" />

      {/* ---------- 日期胶囊导航 ---------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <IconButton icon={<IconLeft />} label="前一天" onClick={() => setDate((d) => shiftDate(d, -1))} />
        <div className="flex h-8 items-center rounded-lg border border-cam-border bg-cam-surface px-1.5">
          <DatePicker
            value={date}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(v) => setDate(String(v))}
            className="cam-date-pill"
          />
          {date === today ? (
            <span className="mr-1 rounded-md bg-cam-accent-dim px-1.5 py-0.5 text-caption text-cam-accent">
              今天
            </span>
          ) : null}
        </div>
        <IconButton
          icon={<IconRight />}
          label="后一天"
          disabled={date >= today}
          onClick={() => setDate((d) => shiftDate(d, 1))}
        />
        {date !== today ? (
          <button
            type="button"
            onClick={() => setDate(today)}
            className="h-8 rounded-lg border border-cam-border px-3 text-caption text-cam-text-secondary transition-colors duration-150 ease-cam hover:border-cam-border-strong hover:text-cam-text-primary"
          >
            回到今天
          </button>
        ) : null}
        <span className="cam-num ml-auto text-caption text-cam-text-tertiary">
          已录制 {recordedHours.toFixed(1)}h · {segments.length} 段
          {modeLabel ? ` · ${modeLabel}` : ''}
        </span>
      </div>

      {/* ---------- 时间轴面板 ---------- */}
      <Panel className="mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cam-border px-4 py-3">
          <h3 className="text-section-title text-cam-text-primary">今日时间轴</h3>
          <div className="flex flex-wrap items-center gap-4">
            <LegendSwatch className="h-2.5 w-4 rounded-sm bg-cam-accent" label="录像段" />
            <LegendSwatch className="h-2.5 w-0.5 bg-cam-text-secondary" label="移动侦测" />
            <LegendSwatch className="h-2.5 w-0.5 bg-cam-warning" label="自检事件" />
            <LegendSwatch className="h-2.5 w-0.5 bg-cam-danger" label="异常" />
          </div>
        </div>
        <div className="px-4 pb-4 pt-3">
          {timelineEmpty ? (
            <EmptyState
              title={`${date} 没有录像与事件`}
              description="可能当天未开启录像，或录像已被保留策略清理。"
            />
          ) : (
            <div className="cam-timeline">
              <div className="cam-tl-track" />
              {Array.from({ length: 25 }, (_, i) => (
                <div
                  key={i}
                  className={cx('cam-tl-hour', i % 4 === 0 && 'major')}
                  style={{ left: `${(i / 24) * 100}%` }}
                />
              ))}
              {Array.from({ length: 7 }, (_, i) => (
                <span
                  key={i}
                  className="cam-tl-hour-label"
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
                  current !== null && b.segs.some((s) => s.name === current.name) ? current : b.segs[0]
                const sizeBytes = b.segs.reduce((acc, s) => acc + s.size_bytes, 0)
                const title =
                  b.segs.length === 1
                    ? `${b.segs[0].name}\n${formatTime(b.start)} – ${formatTime(b.end)}（${formatBytes(b.segs[0].size_bytes)}）`
                    : `${b.segs.length} 段连续录像\n${formatTime(b.start)} – ${formatTime(b.end)}（共 ${formatBytes(sizeBytes)}）`
                return (
                  <div
                    key={b.segs[0].name}
                    className={cx('cam-tl-seg', isCurrent && 'current')}
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

              {eventTicks.map((t, i) => {
                const widthPct = Math.max(0.2, t.endPct - t.leftPct)
                // 密集事件链并成了一根宽刻度 → 渲染为半透明软条带，露出活动范围
                const dense = t.count > 1 && widthPct > 0.4
                const title =
                  t.count === 1
                    ? `${formatTime(t.first.time)} ${eventTypeLabel(t.first.type, t.first.detail)}${
                        t.first.type === 'motion' ? `（得分 ${t.first.score}）` : ''
                      }`
                    : `${formatTime(t.first.time)} – ${formatTime(t.last.time)} 共 ${t.count} 条${
                        t.kind === 'motion' ? '移动侦测' : '自检'
                      }事件`
                return (
                  <div
                    key={`${t.kind}-${i}`}
                    className={cx('cam-tl-event', t.kind, dense && 'dense')}
                    style={{ left: `${t.leftPct}%`, width: `${widthPct}%` }}
                    title={title}
                    role="button"
                    tabIndex={0}
                    aria-label={`跳转到 ${formatTime(t.first.time)} 的事件`}
                    onClick={() => playAt(t.first.time)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        playAt(t.first.time)
                      }
                    }}
                  />
                )
              })}

              {playheadPct != null ? (
                <div className="cam-tl-playhead" style={{ left: `${playheadPct}%` }}>
                  <span className="cam-num cam-tl-playhead-tag">{formatTime(absoluteTime).slice(0, 5)}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Panel>

      {/* ---------- 播放器面板 ---------- */}
      <Panel className="p-4">
        <div ref={playerBoxRef} className="relative overflow-hidden rounded-xl bg-black">
          {current && src ? (
            <>
              <video
                ref={videoRef}
                src={src}
                preload="metadata"
                className="block max-h-[56vh] w-full bg-black"
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={(e) => {
                  if (!seeking) setPos(e.currentTarget.currentTime)
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setVideoError(`无法播放 ${current.name}（分段可能损坏或缺 moov）`)}
              />
              <span className="cam-num absolute left-3 top-3 z-10 rounded-md bg-black/45 px-2 py-1 text-caption text-white/85 backdrop-blur-md">
                回放 · {current.name} · {absoluteTime ? formatTime(absoluteTime) : ''}
              </span>
            </>
          ) : (
            <div className="flex aspect-video max-h-[56vh] flex-col items-center justify-center gap-2 px-4 text-center">
              {IS_MOCK ? (
                <>
                  <span className="text-body text-cam-text-tertiary">mock 模式没有真实 mp4 视频源</span>
                  <span className="max-w-[420px] text-caption leading-5 text-cam-text-tertiary">
                    时间轴、跳转与分段选择逻辑可正常自查；播放需连接后端（VITE_API_MODE=real）。
                  </span>
                </>
              ) : (
                <span className="text-body text-cam-text-tertiary">
                  点击时间轴上的录像段或事件刻度开始播放
                </span>
              )}
            </div>
          )}
        </div>

        {videoError ? <Alert type="error" content={videoError} className="mt-3" /> : null}

        {/* 控制条：播放 / 时间（mono）/ 进度 / 倍速 / 全屏 —— 无声也保持专业播放器结构（任务书 §25） */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            shape="circle"
            type="primary"
            size="large"
            icon={playing ? <IconPause /> : <IconPlayArrowFill />}
            onClick={togglePlay}
            disabled={!current || !src}
            aria-label={playing ? '暂停' : '播放'}
          />
          <span className="cam-num shrink-0 text-caption text-cam-text-secondary">
            {formatClockLong(pos)} / {formatClockLong(segDuration)}
          </span>
          <Slider
            className="min-w-[160px] flex-1"
            min={0}
            max={Math.max(1, segDuration)}
            step={0.1}
            value={Math.min(pos, segDuration)}
            disabled={!current || !src}
            formatTooltip={(v) => formatClockLong(Number(v))}
            onChange={(v) => {
              setSeeking(true)
              seekTo(Number(v))
            }}
            onAfterChange={() => setSeeking(false)}
            aria-label="播放进度"
          />
          <Radio.Group
            type="button"
            size="small"
            value={rate}
            onChange={(v) => setRate(Number(v))}
            aria-label="播放倍速"
          >
            {[0.5, 1, 2].map((r) => (
              <Radio key={r} value={r}>
                {r}x
              </Radio>
            ))}
          </Radio.Group>
          <Button type="outline" onClick={fullscreen} aria-label="全屏">
            全屏
          </Button>
        </div>
      </Panel>
    </>
  )
}
