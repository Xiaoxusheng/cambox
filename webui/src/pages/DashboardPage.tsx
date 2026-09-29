/**
 * /dashboard 系统概览 —— CamBox System Overview（v1.4 Linear-style 重构，任务书 §40~42）。
 * 布局：Compact Metrics 一行四项（相机 / 录像 / 存储 / 事件）+ 系统状态列表
 *       （相机健康 / 存储 / 录像 / 侦测与布防 / 通知 / 画面自检）+ 今日趋势 + 最新事件。
 * 不是巨大 Dashboard Cards：指标与状态全部行式排版，中性色 + 语义点。
 * 5s 静默轮询、自检低频刷新、布防快捷开关逻辑全部保留。
 */
import { useState } from 'react'
import { Message, Switch } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import { Link } from 'react-router-dom'
import { fetchConfig, fetchEvents, fetchStatus, fetchTimeline, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import type { Config, Event, Status, TimelineData } from '../api/types'
import { EventList } from '../components/EventList'
import { HourlyChart } from '../components/HourlyChart'
import { IconButton } from '../components/common/IconButton'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { cx } from '../utils/cx'
import { formatGB, formatTime, formatUptime, selfCheckView, toLocalDateStr } from '../utils/format'

const GB = 1024 ** 3

type DashboardData = [Status, TimelineData, Event[]]

const dayStart = (s: string) => new Date(`${s}T00:00:00`).toISOString()
const dayEnd = (s: string) => new Date(`${s}T23:59:59.999`).toISOString()

/** 当日自检事件按小时分桶（长度 24） */
function bucketSelfcheck(events: Event[]): number[] {
  const out = Array.from({ length: 24 }, () => 0)
  for (const e of events) {
    const d = new Date(e.time)
    if (!Number.isNaN(d.getTime())) out[d.getHours()] += 1
  }
  return out
}

/** Compact Metric（任务书 §41：不是巨大 Dashboard Cards）：label + 主值 + 副值 */
function Metric({
  label,
  value,
  valueMono = false,
  sub,
  bar,
}: {
  label: string
  value: React.ReactNode
  valueMono?: boolean
  sub?: React.ReactNode
  /** 0~100 存储水位条 */
  bar?: number
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-caption uppercase tracking-[0.06em] text-cam-text-tertiary">{label}</div>
      <div
        className={cx(
          'mt-1.5 truncate text-metric',
          valueMono && 'cam-num',
          'text-cam-text-primary',
        )}
      >
        {value}
      </div>
      {typeof bar === 'number' ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-cam-active">
          <div
            className="h-full rounded-full"
            style={{
              width: `${bar}%`,
              background:
                bar >= 90
                  ? 'rgb(var(--cam-danger-rgb))'
                  : bar >= 75
                    ? 'rgb(var(--cam-warning-rgb))'
                    : 'var(--cam-meter)',
            }}
          />
        </div>
      ) : null}
      {sub ? <div className="mt-1 truncate text-caption text-cam-text-tertiary">{sub}</div> : null}
    </div>
  )
}

/** 系统状态行：名称+描述 左，状态点+状态文字 右 */
function StatusRow({
  name,
  desc,
  dot,
  status,
  children,
}: {
  name: string
  desc?: string
  /** 语义点颜色：ok=success / warn / err / rec=录像红 / neutral */
  dot: 'ok' | 'warn' | 'err' | 'rec' | 'neutral'
  status: React.ReactNode
  /** 右侧控件（如布防 Switch） */
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-body-secondary text-cam-text-primary">{name}</div>
        {desc ? <div className="mt-0.5 truncate text-caption text-cam-text-tertiary">{desc}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {children}
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            dot === 'ok' && 'bg-cam-success',
            dot === 'warn' && 'bg-cam-warning',
            dot === 'err' && 'bg-cam-danger',
            dot === 'rec' && 'animate-rec-pulse bg-cam-rec',
            dot === 'neutral' && 'bg-cam-text-4',
          )}
        />
        <span className="max-w-[200px] truncate text-body-secondary text-cam-text-secondary">{status}</span>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const today = toLocalDateStr(new Date())
  const [armPending, setArmPending] = useState(false)

  const { data, loading, error, reload } = useAsync<DashboardData>(
    (signal) =>
      Promise.all([
        fetchStatus(signal),
        fetchTimeline(today, signal),
        fetchEvents({ limit: 6, offset: 0 }, signal),
      ]).then(([s, t, ev]) => [s, t, ev.items] as DashboardData),
    [today],
    { pollMs: 5000 },
  )
  // 自检分桶不必每 5s 重拉：单独低频刷新
  const { data: selfcheckEvents } = useAsync(
    (signal) =>
      fetchEvents({ limit: 500, offset: 0, type: 'selfcheck', from: dayStart(today), to: dayEnd(today) }, signal),
    [today],
  )
  // 通知通道概览：配置只在进入页面时取一次
  const { data: config } = useAsync<Config>((signal) => fetchConfig(signal), [])

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const [status, timeline, events] = data
  const cam = status.camera
  const diskPct = Math.min(100, (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * GB)) * 100)
  const sc = selfCheckView(status.selfcheck)
  const modeLabel =
    status.recorder.mode === 'copy' ? '流复制' : status.recorder.mode === 'encode' ? '编码' : status.recorder.mode
  const selfcheckHourly = bucketSelfcheck(selfcheckEvents?.items ?? [])
  const todayCount = timeline.hourly.reduce((a, b) => a + b, 0)

  const notifyChannels = config
    ? ([
        ['钉钉', config.notify.dingtalk.enabled],
        ['企业微信', config.notify.wecom.enabled],
        ['Telegram', config.notify.telegram.enabled],
        ['Bark', config.notify.bark.enabled],
        ['Webhook', config.notify.webhook.enabled],
      ] as const)
    : []
  const notifyOn = notifyChannels.filter(([, on]) => on).map(([name]) => name)

  async function toggleArm(next: boolean) {
    setArmPending(true)
    try {
      await setArmed(next)
      Message.success(
        next ? '已布防，移动侦测事件将入库并推送' : '已撤防，仅停止事件入库与推送（录像不受影响）',
      )
      reload()
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setArmPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---------- 页头 ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-page-title text-cam-text-primary">系统概览</h2>
          <p className="mt-1.5 text-body-secondary text-cam-text-tertiary">
            系统状态与活动 · 数据时间 {formatTime(status.time)} · 每 5 秒自动刷新
            {error ? <span className="text-cam-danger"> · 刷新失败：{error}</span> : null}
          </p>
        </div>
        <IconButton icon={<IconRefresh />} label="刷新" onClick={() => reload()} />
      </div>

      {/* ---------- Compact Metrics（任务书 §41：单面板分栏，不是四张大卡） ---------- */}
      <div className="grid grid-cols-2 divide-cam-border rounded-panel border border-cam-border bg-cam-surface lg:grid-cols-4 lg:divide-x max-lg:gap-px max-lg:bg-cam-border max-lg:pb-px max-lg:[&>*]:bg-cam-surface">
        <Metric
          label="Camera"
          value={cam.connected ? 'Online' : 'Offline'}
          sub={`${cam.type.toUpperCase()} · ${cam.fps.toFixed(1)} FPS · ${cam.width}×${cam.height}`}
        />
        <Metric
          label="Recording"
          value={
            status.recorder.running ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-rec-pulse rounded-full bg-cam-rec" />
                录像中
              </span>
            ) : status.recorder.enabled ? (
              '待机'
            ) : (
              '已关闭'
            )
          }
          valueMono={false}
          sub={status.recorder.current_file || (status.recorder.enabled ? modeLabel : '配置已关闭')}
        />
        <Metric
          label="Storage"
          value={
            <span className="cam-num">
              {formatGB(status.disk.recordings_bytes)}
              <span className="text-caption font-normal text-cam-text-tertiary"> / {status.disk.max_gb} GB</span>
            </span>
          }
          valueMono
          bar={diskPct}
          sub={`快照 ${formatGB(status.disk.snapshots_bytes)} GB · 到限自动清理`}
        />
        <Metric
          label="Events"
          value={<span className="cam-num">{status.events_count}</span>}
          valueMono
          sub={`今日 ${todayCount} 条 · 运行 ${formatUptime(status.uptime_sec)}`}
        />
      </div>

      {/* ---------- 系统状态 + 趋势 │ 最新事件 ---------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          {/* 系统状态列表（任务书 §42：list/section，不堆卡片） */}
          <div className="rounded-panel border border-cam-border bg-cam-surface px-4 py-1">
            <h3 className="border-b border-cam-border py-2.5 text-section-title text-cam-text-primary">
              系统状态
            </h3>
            <div className="divide-y divide-cam-border">
              <StatusRow
                name="相机健康"
                desc={`重启 ${cam.restarts} 次${cam.last_error ? ` · ${cam.last_error}` : ''}`}
                dot={cam.connected ? 'ok' : 'err'}
                status={cam.connected ? '在线' : '离线 · 等待取流'}
              />
              <StatusRow
                name="存储"
                desc={`录像 ${formatGB(status.disk.recordings_bytes)} / ${status.disk.max_gb} GB · 快照 ${formatGB(status.disk.snapshots_bytes)} GB`}
                dot={diskPct >= 90 ? 'err' : diskPct >= 75 ? 'warn' : 'ok'}
                status={`已用 ${diskPct.toFixed(0)}%`}
              />
              <StatusRow
                name="录像"
                desc={status.recorder.current_file ? `当前分段 ${status.recorder.current_file}` : modeLabel || undefined}
                dot={status.recorder.running ? 'rec' : 'neutral'}
                status={
                  status.recorder.running ? (
                    <span>录像中 · {modeLabel}</span>
                  ) : status.recorder.enabled ? (
                    '待机'
                  ) : (
                    '已关闭'
                  )
                }
              />
              <StatusRow
                name="侦测与布防"
                desc={`日程 · 侦测 ${status.schedule_active.motion ? '开' : '关'} / 录像 ${status.schedule_active.record ? '开' : '关'}`}
                dot={status.armed ? 'ok' : 'neutral'}
                status={status.armed ? '布防中' : '已撤防'}
              >
                <Switch
                  size="small"
                  checked={status.armed}
                  loading={armPending}
                  onChange={toggleArm}
                  aria-label="布防开关"
                />
              </StatusRow>
              <StatusRow
                name="通知"
                desc={notifyOn.length > 0 ? notifyOn.join(' / ') : '未启用任何推送通道'}
                dot={notifyOn.length > 0 ? 'ok' : 'neutral'}
                status={notifyOn.length > 0 ? `${notifyOn.length} 个通道` : '关闭'}
              />
              <StatusRow
                name="画面自检"
                desc={
                  status.selfcheck.enabled
                    ? `上次 ${formatTime(status.selfcheck.last_run)} · 连续冻结 ${status.selfcheck.consecutive_frozen} / 突变 ${status.selfcheck.consecutive_change}`
                    : '未启用'
                }
                dot={sc.dot === 'ok' ? 'ok' : sc.dot === 'warn' ? 'warn' : sc.dot === 'err' ? 'err' : 'neutral'}
                status={sc.text}
              />
            </div>
          </div>

          {/* 今日事件趋势 */}
          <div className="rounded-panel border border-cam-border bg-cam-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cam-border px-4 py-3">
              <h3 className="text-section-title text-cam-text-primary">今日事件趋势</h3>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-caption text-cam-text-tertiary">
                  <i className="inline-block h-2 w-2 rounded-sm bg-cam-text-2" />
                  移动侦测
                </span>
                <span className="inline-flex items-center gap-1.5 text-caption text-cam-text-tertiary">
                  <i className="inline-block h-2 w-2 rounded-sm bg-cam-warning/75" />
                  画面自检
                </span>
                <span className="cam-num rounded bg-cam-active px-1.5 py-0.5 text-caption text-cam-text-secondary">
                  {timeline.date}
                </span>
              </div>
            </div>
            <div className="px-4 py-3">
              <HourlyChart hourly={timeline.hourly} selfcheck={selfcheckHourly} date={timeline.date} height={200} />
            </div>
          </div>
        </div>

        {/* 最新事件 */}
        <div className="flex min-h-0 flex-col rounded-panel border border-cam-border bg-cam-surface">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cam-border px-4 py-3">
            <h3 className="text-section-title text-cam-text-primary">最新事件</h3>
            <Link
              to="/events"
              className="text-caption text-cam-text-secondary no-underline transition-colors duration-150 ease-cam hover:text-cam-text-primary"
            >
              全部 →
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <EventList items={events} cameraName={cam.name} compact />
          </div>
        </div>
      </div>
    </div>
  )
}
