/**
 * /playback 回看 —— CamBox Playback Workspace（v1.4 Linear-style 重构，任务书 §35~38）。
 * 布局：日期导航 → 播放器（黑底 contain，主角）→ 24h 时间轴（中性录像段 + 事件 marker + 播放头）
 *       → 自绘控制条（播放/时间/进度/倍速/全屏）。
 * 跳转规则（契约 §4）不变：video.currentTime = 事件时间 − 所在录像段 start。
 * 合并/聚合算法原样保留（30min 合并、0.35% 聚合）；录像段改中性灰，事件 marker 语义色。
 * 支持外部带参跳转：/playback?date=YYYY-MM-DD&t=当日秒偏移（事件详情「查看回放」入口）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, DatePicker, Message, Slider } from '@arco-design/web-react'
import {
  IconLeft,
  IconPause,
  IconPlayArrowFill,
  IconRight,
} from '@arco-design/web-react/icon'
import { useSearchParams } from 'react-router-dom'
import { fetchStatus, fetchTimeline } from '../api/endpoints'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { Event, Status, TimelineData, TimelineSegment } from '../api/types'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { IconButton } from '../components/common/IconButton'
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

/** 时间轴图例色块（录像段=中性灰带；刻度=中性/警告/危险） */
function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-cam-text-tertiary">
      <i className={cx('inline-block', className)} />
      {label}
    </span>
  )
}

/** 控制条播放/暂停按钮：中性实底圆角按钮，克制的专业播放器样式 */
function PlayButton({ playing, disabled, onClick }: { playing: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={playing ? '暂停' : '播放'}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        'bg-cam-selected text-cam-text-primary transition-colors duration-150 ease-cam',
        'hover:bg-cam-active disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {playing ? <IconPause style={{ fontSize: 15 }} /> : <IconPlayArrowFill style={{ fontSize: 15 }} />}
    </button>
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
  // 时间轴 hover 预览（任务书 §37）：跟随光标显示该位置的时刻；契约无逐时刻缩略图，仅时间
  const timelineRef = useRef<HTMLDivElement>(null)
  const [hoverSec, setHoverSec] = useState<number | null>(null)
  const { data, loading, error, reload } = useAsync<PlaybackData>(
    (signal) => Promise.all([fetchTimeline(date, signal), fetchStatus(signal)]),
    [date],
  )

  // ---- 外部带参跳转（事件详情「查看回放」）----
  const [searchParams, setSearchParams] = useSearchParams()
  const jumpRef = useRef<{ date: string; sec: number | null } | null>(null)
  useEffect(() => {
    const d = searchParams.get('date')
    const t = searchParams.get('t')
    if (d) {
      setDate(d)
      jumpRef.current = { date: d, sec: t != null && !Number.isNaN(Number(t)) ? Number(t) : null }
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
   * 超过 30 分钟的空档（真的长时间停录）才会断开。算法原样保留。
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
    const hit = segments.find((s) => t >= new Date(s.start).getTime() && t <= new Date(s.end).getTime())
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

  // 带参跳转：数据就绪且日期匹配时执行一次
  useEffect(() => {
    const j = jumpRef.current
    if (!data || !j || j.date !== date) return
    jumpRef.current = null
    if (j.sec != null) {
      const target = new Date(new Date(`${date}T00:00:00`).getTime() + j.sec * 1000).toISOString()
      playAt(target)
    }
  }, [data, date])

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

  /** 时间轴 hover：换算光标位置为当日秒偏移（任务书 §37） */
  const onTimelineHover = (e: React.MouseEvent) => {
    const el = timelineRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setHoverSec(pct * 86400)
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
  const camName = data[1].camera.name

  return (
    <div className="flex flex-col gap-3">
      {/* ---------- 页头：标题 + 相机/日期 context；录制统计为 metadata（任务书 §32） ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-page-title text-cam-text-primary">回看</h2>
          <p className="mt-1.5 text-body-secondary text-cam-text-tertiary">
            {camName} · <span className="cam-num">{date}</span>
            {date === today ? '（今天）' : ''}
          </p>
        </div>
        <span className="cam-num text-caption text-cam-text-tertiary">
          已录制 {recordedHours.toFixed(1)}h · {segments.length} 段
          {modeLabel ? ` · ${modeLabel}` : ''}
        </span>
      </div>

      {/* ---------- 日期导航（更轻：返回键 + 日期 + 今天 chip） ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={<IconLeft />} label="前一天" onClick={() => setDate((d) => shiftDate(d, -1))} />
        <div className="flex h-8 items-center rounded-md border border-cam-border bg-cam-surface px-1.5">
          <DatePicker
            value={date}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(v) => setDate(String(v))}
            className="cam-date-pill"
          />
        </div>
        <IconButton
          icon={<IconRight />}
          label="后一天"
          disabled={date >= today}
          onClick={() => setDate((d) => shiftDate(d, 1))}
        />
        {date === today ? (
          <span className="rounded bg-cam-selected px-1.5 py-0.5 text-caption text-cam-text-secondary">今天</span>
        ) : (
          <button
            type="button"
            onClick={() => setDate(today)}
            className="h-8 rounded-md px-2.5 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-hover hover:text-cam-text-primary"
          >
            回到今天
          </button>
        )}
      </div>

      {/* ---------- 播放器：主角 Surface（border + 8px，任务书 §34） ---------- */}
      <div ref={playerBoxRef} className="relative overflow-hidden rounded-lg border border-cam-border bg-black">
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
            {/* HUD：仅 左=当前时刻 右=相机名（任务书 §35，不堆 chip） */}
            <span className="cam-num absolute left-3 top-3 z-10 inline-flex h-6 items-center rounded-md bg-black/45 px-2 text-caption text-white/85 backdrop-blur-md">
              {absoluteTime ? formatTime(absoluteTime) : ''}
            </span>
            <span className="cam-num absolute right-3 top-3 z-10 inline-flex h-6 items-center rounded-md bg-black/45 px-2 text-caption text-white/70 backdrop-blur-md">
              {camName}
            </span>
          </>
        ) : (
          <div className="flex aspect-video max-h-[56vh] flex-col items-center justify-center gap-2 px-4 text-center">
            {IS_MOCK ? (
              <>
                <span className="text-body text-cam-text-tertiary">mock 模式没有真实 mp4 视频源</span>
                <span className="max-w-[420px] text-body-secondary leading-5 text-cam-text-tertiary">
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

      {videoError ? <Alert type="error" content={videoError} /> : null}

      {/* ---------- 24h 时间轴（录像段=中性灰带，事件=小 marker） ---------- */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-section-title text-cam-text-primary">时间轴</h2>
          <div className="flex flex-wrap items-center gap-4">
            <LegendSwatch className="h-2.5 w-4 rounded-sm bg-cam-tl-seg" label="录像段" />
            <LegendSwatch className="h-2.5 w-0.5 bg-cam-text-secondary" label="移动侦测" />
            <LegendSwatch className="h-2.5 w-0.5 bg-cam-warning" label="画面冻结" />
            <LegendSwatch className="h-2.5 w-0.5 bg-cam-danger" label="画面异常" />
          </div>
        </div>
        {timelineEmpty ? (
          <EmptyState
            title="没有录像与事件"
            description="可能当天未开启录像，或录像已被保留策略清理。换个日期试试。"
          />
        ) : (
          <div
            ref={timelineRef}
            className="cam-timeline"
            onMouseMove={onTimelineHover}
            onMouseLeave={() => setHoverSec(null)}
          >
            {/* hover 预览：跟随光标的小时刻 chip（任务书 §37：不做巨大 Tooltip） */}
            {hoverSec != null ? (
              <span
                className="cam-num pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded border border-cam-border-strong bg-cam-elevated px-1.5 py-0.5 text-[11px] leading-4 text-cam-text-secondary shadow-popover"
                style={{ left: `clamp(28px, ${((hoverSec / 86400) * 100).toFixed(2)}%, calc(100% - 28px))` }}
              >
                {`${String(Math.floor(hoverSec / 3600)).padStart(2, '0')}:${String(
                  Math.floor((hoverSec % 3600) / 60),
                ).padStart(2, '0')}`}
              </span>
            ) : null}
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
                className={cx('cam-tl-hour-label', i % 2 === 1 && 'hidden sm:block')}
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

      {/* ---------- 控制条：播放 / 时间（mono）/ 进度 / 倍速 / 全屏（任务书 §38 只留核心） ---------- */}
      <div className="flex flex-wrap items-center gap-3">
        <PlayButton playing={playing} disabled={!current || !src} onClick={togglePlay} />
        <span className="cam-num shrink-0 text-caption text-cam-text-secondary">
          {formatClockLong(pos)} / {formatClockLong(segDuration)}
        </span>
        <button
          type="button"
          onClick={fullscreen}
          aria-label="全屏"
          disabled={!current || !src}
          className="order-3 inline-flex h-8 shrink-0 items-center rounded-md border border-cam-border px-3 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:border-cam-border-strong hover:text-cam-text-primary disabled:pointer-events-none disabled:opacity-40 sm:order-none"
        >
          全屏
        </button>
        <div className="order-4 flex w-full min-w-0 items-center gap-3 sm:order-none sm:w-auto sm:flex-1">
        <Slider
          className="min-w-0 flex-1"
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
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-cam-border p-0.5" role="radiogroup" aria-label="播放倍速">
          {[0.5, 1, 2].map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rate === r}
              onClick={() => setRate(r)}
              className={cx(
                'h-7 rounded px-2.5 text-caption font-medium transition-colors duration-150 ease-cam',
                rate === r
                  ? 'bg-cam-selected text-cam-text-primary'
                  : 'text-cam-text-tertiary hover:text-cam-text-primary',
              )}
            >
              {r}x
            </button>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}
