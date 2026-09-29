/**
 * /dashboard 概览 —— camhub v1.3 重设计（Phase 6）。
 * 布局（任务书 §30：System Overview，最多 4 个核心指标）：4 指标卡（连接/录像/存储/运行）
 * + 布防·自检状态条（快捷开关）+ 今日事件趋势（HourlyChart）+ 最新事件（EventList 复用）。
 * 5s 静默轮询、自检低频刷新、布防快捷开关逻辑全部保留。
 */
import { useState } from 'react'
import { Message, Switch } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import { Link } from 'react-router-dom'
import { fetchEvents, fetchStatus, fetchTimeline, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import type { Event, Status, TimelineData } from '../api/types'
import { EventList } from '../components/EventList'
import { HourlyChart } from '../components/HourlyChart'
import { IconButton } from '../components/common/IconButton'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/common/Panel'
import { StatusBadge } from '../components/common/StatusBadge'
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

/** 指标卡：label（caption 次要）+ 主值（20px/600 mono 可选）+ 副值（caption 三级） */
function Metric({
  label,
  value,
  valueMono = false,
  sub,
  accent = false,
  bar,
}: {
  label: string
  value: React.ReactNode
  valueMono?: boolean
  sub?: React.ReactNode
  accent?: boolean
  /** 0~100 存储水位条 */
  bar?: number
}) {
  return (
    <Panel className="min-w-0 px-4 py-3.5">
      <div className="text-caption text-cam-text-tertiary">{label}</div>
      <div
        className={cx(
          'mt-1.5 truncate text-[20px] font-semibold leading-7',
          valueMono ? 'cam-num' : '',
          accent ? 'text-cam-accent' : 'text-cam-text-primary',
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
                    : 'rgb(var(--cam-accent-rgb))',
            }}
          />
        </div>
      ) : null}
      {sub ? <div className="mt-1 truncate text-caption text-cam-text-tertiary">{sub}</div> : null}
    </Panel>
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
        fetchEvents({ limit: 5, offset: 0 }, signal),
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

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const [status, timeline, events] = data
  const cam = status.camera
  const diskPct = Math.min(
    100,
    (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * GB)) * 100,
  )
  const sc = selfCheckView(status.selfcheck)
  const modeLabel =
    status.recorder.mode === 'copy' ? '流复制' : status.recorder.mode === 'encode' ? '编码' : status.recorder.mode
  const selfcheckHourly = bucketSelfcheck(selfcheckEvents?.items ?? [])

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
    <>
      <PageHeader
        title="概览"
        description={
          <>
            数据时间 {formatTime(status.time)} · 每 5 秒自动刷新
            {error ? <span className="text-cam-danger"> · 刷新失败：{error}</span> : null}
          </>
        }
        actions={<IconButton icon={<IconRefresh />} label="刷新" onClick={() => reload()} />}
      />

      {/* ---------- 4 核心指标（任务书 §30：不堆卡） ---------- */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="相机连接"
          value={cam.connected ? '已连接' : '未连接'}
          accent={cam.connected}
          sub={`${cam.type.toUpperCase()} · ${cam.fps.toFixed(1)} FPS · ${cam.width}×${cam.height}`}
        />
        <Metric
          label="录像"
          value={
            status.recorder.running ? (
              <span className="inline-flex items-center gap-1.5">
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
          label="存储水位"
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
          label="运行时长"
          value={formatUptime(status.uptime_sec)}
          valueMono
          sub={`累计事件 ${status.events_count} 条`}
        />
      </div>

      {/* ---------- 布防 · 自检状态条（快捷开关，非指标卡） ---------- */}
      <Panel className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <span className="flex items-center gap-2">
          <StatusBadge
            tone={status.armed ? 'accent' : 'neutral'}
            label={status.armed ? '布防中' : '已撤防'}
            breathe={status.armed}
          />
          <Switch
            size="small"
            checked={status.armed}
            loading={armPending}
            onChange={toggleArm}
            aria-label="布防开关"
          />
          <span className="hidden text-caption text-cam-text-tertiary md:inline">
            日程 · 侦测 {status.schedule_active.motion ? '开' : '关'} / 录像{' '}
            {status.schedule_active.record ? '开' : '关'}
          </span>
        </span>
        <span className="h-4 w-px bg-cam-border-strong" aria-hidden="true" />
        <span className="flex items-center gap-2">
          <span
            className={cx(
              'h-1.5 w-1.5 rounded-full',
              sc.dot === 'ok' && 'bg-cam-success',
              sc.dot === 'warn' && 'bg-cam-warning',
              sc.dot === 'err' && 'bg-cam-danger',
              sc.dot === 'off' && 'bg-cam-text-4',
            )}
          />
          <span className="text-caption text-cam-text-secondary">画面自检 {sc.text}</span>
          <span className="hidden text-caption text-cam-text-tertiary md:inline">
            {status.selfcheck.enabled ? `上次 ${formatTime(status.selfcheck.last_run)}` : '未启用'}
          </span>
        </span>
      </Panel>

      {/* ---------- 趋势 + 最新事件 ---------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cam-border px-4 py-3">
            <h3 className="text-section-title text-cam-text-primary">今日事件趋势</h3>
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-caption text-cam-text-tertiary">
                <i className="inline-block h-2 w-2 rounded-sm bg-cam-accent" />
                移动侦测
              </span>
              <span className="inline-flex items-center gap-1.5 text-caption text-cam-text-tertiary">
                <i className="inline-block h-2 w-2 rounded-sm bg-cam-warning" />
                画面自检
              </span>
              <span className="cam-num rounded-md bg-cam-active px-1.5 py-0.5 text-caption text-cam-text-secondary">
                {timeline.date}
              </span>
            </div>
          </div>
          <div className="px-4 py-3">
            <HourlyChart hourly={timeline.hourly} selfcheck={selfcheckHourly} date={timeline.date} height={252} />
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cam-border px-4 py-3">
            <h3 className="text-section-title text-cam-text-primary">最新事件</h3>
            <Link
              to="/events"
              className="text-caption text-cam-accent no-underline transition-colors duration-150 ease-cam hover:text-cam-accent/80"
            >
              全部 →
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <EventList items={events} cameraName={cam.name} />
          </div>
        </Panel>
      </div>
    </>
  )
}
