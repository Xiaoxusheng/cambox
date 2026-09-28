/**
 * /dashboard 概览（v1.3 按 camhub-ui-4k/02 设计稿重做）
 * 信息层级：① 六张状态卡 ② 今日事件趋势（侦测/自检双系列） ③ 最新事件。
 */
import { useState } from 'react'
import { Button, Message, Switch } from '@arco-design/web-react'
import { IconDashboard, IconNotification, IconRefresh } from '@arco-design/web-react/icon'
import { fetchEvents, fetchStatus, fetchTimeline, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import type { Event, Status, TimelineData } from '../api/types'
import { HourlyChart } from '../components/HourlyChart'
import { EventList } from '../components/EventList'
import { PageHeader } from '../components/PageHeader'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
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
            数据时间 <span className="num">{formatTime(status.time)}</span> · 每 5 秒自动刷新
            {error ? <span style={{ color: 'var(--ch-danger)' }}> · 刷新失败：{error}</span> : null}
          </>
        }
        actions={
          <Button className="ch-btn" icon={<IconRefresh />} loading={loading} onClick={reload}>
            刷新
          </Button>
        }
      />

      <div className="ch-stats">
        <div className={`ch-statcard ${cam.connected ? 'accent-ok' : 'accent-danger'}`}>
          <div className="ch-stat-label">连接</div>
          <div className={`ch-stat-value ${cam.connected ? 'ok' : 'danger'}`}>
            <span className={`ch-status-dot ${cam.connected ? 'ok' : 'err'}`} />
            {cam.connected ? '已连接' : '未连接'}
          </div>
          <div className="ch-stat-sub">
            {cam.type.toUpperCase()} · <span className="num">{cam.fps.toFixed(1)} FPS</span>
          </div>
        </div>

        <div className={`ch-statcard ${status.recorder.running ? 'accent-danger' : 'accent-muted'}`}>
          <div className="ch-stat-label">录像</div>
          <div className="ch-stat-value">{status.recorder.running ? '录像中' : '已停止'}</div>
          <div className="ch-stat-sub num" title={status.recorder.current_file}>
            {status.recorder.enabled
              ? [status.recorder.current_file || '等待分段', modeLabel].filter(Boolean).join(' · ')
              : '配置已关闭'}
          </div>
        </div>

        <div className={`ch-statcard ${status.armed ? 'accent-cyan' : 'accent-muted'}`}>
          <div className="ch-stat-label">布防</div>
          <div className="ch-stat-value" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: status.armed ? 'var(--ch-primary)' : 'var(--ch-text-3)' }}>
              {status.armed ? '布防中' : '已撤防'}
            </span>
            <Switch
              size="small"
              checked={status.armed}
              loading={armPending}
              onChange={toggleArm}
              aria-label="布防开关"
            />
          </div>
          <div className="ch-stat-sub">
            日程 · 侦测 {status.schedule_active.motion ? '开' : '关'} / 录像{' '}
            {status.schedule_active.record ? '开' : '关'}
          </div>
        </div>

        <div className="ch-statcard accent-cyan">
          <div className="ch-stat-label">磁盘水位</div>
          <div
            className={`ch-stat-value num ${diskPct >= 90 ? 'danger' : diskPct >= 75 ? 'warn' : 'cyan'}`}
          >
            {diskPct.toFixed(1)}%
          </div>
          <div className="ch-meter" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={Math.round(diskPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`磁盘使用率 ${diskPct.toFixed(1)}%`}>
            <span
              className="ch-meter-fill"
              style={{
                display: 'block',
                width: `${diskPct}%`,
                background:
                  diskPct >= 90 ? 'var(--ch-danger)' : diskPct >= 75 ? 'var(--ch-warn)' : 'var(--ch-primary)',
              }}
            />
          </div>
          <div className="ch-stat-sub num">
            {formatGB(status.disk.recordings_bytes)} / {status.disk.max_gb} GB
          </div>
        </div>

        <div className="ch-statcard accent-muted">
          <div className="ch-stat-label">运行时长</div>
          <div className="ch-stat-value num">{formatUptime(status.uptime_sec)}</div>
          <div className="ch-stat-sub num">累计事件 {status.events_count} 条</div>
        </div>

        <div className={`ch-statcard ${sc.dot === 'ok' ? 'accent-ok' : sc.dot === 'warn' ? 'accent-cyan' : 'accent-danger'}`}>
          <div className="ch-stat-label">自检状态</div>
          <div className="ch-stat-value" style={{ color: sc.color }}>
            <span className={`ch-status-dot ${sc.dot}`} />
            {sc.text}
          </div>
          <div className="ch-stat-sub num">
            {status.selfcheck.enabled ? `上次 ${formatTime(status.selfcheck.last_run)}` : '未启用画面自检'}
          </div>
        </div>
      </div>

      <div className="ch-dash-split">
        <section className="ch-panel">
          <header className="ch-panel-head">
            <span className="ch-panel-icon">
              <IconDashboard />
            </span>
            <div className="ch-panel-title">今日事件趋势</div>
            <div className="ch-panel-extra">
              <span className="ch-badge num">{timeline.date}</span>
            </div>
          </header>
          <div className="ch-panel-body">
            <div className="ch-legend" style={{ marginBottom: 12 }}>
              <span>
                <i style={{ background: 'var(--ch-primary)' }} />
                移动侦测
              </span>
              <span>
                <i style={{ background: 'var(--ch-warn)' }} />
                画面自检
              </span>
            </div>
            <HourlyChart
              hourly={timeline.hourly}
              selfcheck={selfcheckHourly}
              date={timeline.date}
              height={252}
            />
          </div>
        </section>

        <section className="ch-panel">
          <header className="ch-panel-head">
            <span className="ch-panel-icon">
              <IconNotification />
            </span>
            <div className="ch-panel-title">最新事件</div>
            <div className="ch-panel-extra">
              <a className="ch-linkbtn" href="#/events">
                全部
              </a>
            </div>
          </header>
          <div className="ch-panel-body">
            <EventList items={events} cameraName={cam.name} />
          </div>
          <footer className="ch-monitor-events-footer">
            <a className="ch-linkbtn" href="#/events">
              前往事件中心
            </a>
          </footer>
        </section>
      </div>
    </>
  )
}
