/**
 * /dashboard 概览
 * 信息层级：① 六个运行状态（含布防开关）② 今日事件趋势 ③ 最新 5 条事件。
 */
import { useState } from 'react'
import { Button, Message, Switch, Tag, Tooltip } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import { fetchEvents, fetchStatus, fetchTimeline, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { EventsResponse, Status, TimelineData } from '../api/types'
import { HourlyChart } from '../components/HourlyChart'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { StorageMeter } from '../components/StorageMeter'
import { useAsync } from '../hooks/useAsync'
import {
  eventTypeLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatTime,
  toLocalDateStr,
} from '../utils/format'

const GB = 1024 ** 3

type DashboardData = [Status, TimelineData, EventsResponse]

function selfCheckView(s: Status['selfcheck']): { text: string; color: string; dot: string } {
  if (!s.enabled) return { text: '已关闭', color: 'var(--color-text-3)', dot: 'off' }
  if (s.state === 'frozen') return { text: '画面冻结', color: 'var(--ch-danger)', dot: 'err' }
  if (s.state === 'occlusion') return { text: '画面异常', color: 'var(--ch-warn)', dot: 'warn' }
  return { text: '正常', color: 'var(--ch-ok)', dot: 'ok' }
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
      ]),
    [today],
    { pollMs: 5000 },
  )

  async function toggleArm(next: boolean) {
    setArmPending(true)
    try {
      await setArmed(next)
      Message.success(next ? '已布防，移动侦测事件将入库并推送' : '已撤防，仅停止事件入库与推送（录像不受影响）')
      reload()
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setArmPending(false)
    }
  }

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const [status, timeline, events] = data
  const diskPct = Math.min(100, (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * GB)) * 100)
  const sc = selfCheckView(status.selfcheck)

  return (
    <>
      <PageHeader
        title="概览"
        description={
          <>
            数据时间 <span className="num">{formatTime(status.time)}</span>
            {error ? <span style={{ color: 'var(--ch-danger)' }}> · 刷新失败：{error}</span> : null}
          </>
        }
        actions={
          <Button icon={<IconRefresh />} loading={loading} onClick={reload}>
            刷新
          </Button>
        }
      />

      <Panel
        title="运行状态"
        extra={
          <Tag color={status.camera.connected ? 'green' : 'red'} size="small">
            {status.camera.connected ? '在线' : '离线'}
          </Tag>
        }
        bodyStyle={{ padding: 0 }}
        style={{ marginBottom: 'var(--ch-space-md)' }}
      >
        <div className="ch-stat-grid">
          <div className="ch-stat-cell">
            <div className="ch-stat-label">连接</div>
            <div className="ch-stat-value">
              <span className={`ch-status-dot ${status.camera.connected ? 'ok' : 'err'}`} />
              {status.camera.connected ? '已连接' : '未连接'}
            </div>
            <div className="ch-stat-sub">
              {status.camera.type} · <span className="num">{status.camera.fps.toFixed(1)} fps</span>
            </div>
          </div>

          <div className="ch-stat-cell">
            <div className="ch-stat-label">录像</div>
            <div className="ch-stat-value">{status.recorder.running ? '录像中' : '已停止'}</div>
            <div className="ch-stat-sub" title={status.recorder.current_file}>
              {status.recorder.enabled
                ? status.recorder.current_file || '等待分段'
                : '配置已关闭'}
            </div>
          </div>

          <div className="ch-stat-cell">
            <div className="ch-stat-label">布防</div>
            <div className="ch-stat-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch
                size="small"
                checked={status.armed}
                loading={armPending}
                onChange={toggleArm}
                aria-label="布防开关"
              />
              <span style={{ color: status.armed ? 'var(--ch-ok)' : 'var(--color-text-3)' }}>
                {status.armed ? '布防中' : '已撤防'}
              </span>
            </div>
            <div className="ch-stat-sub">
              日程 侦测 {status.schedule_active.motion ? '开' : '关'} · 录像{' '}
              {status.schedule_active.record ? '开' : '关'}
            </div>
          </div>

          <div className="ch-stat-cell">
            <div className="ch-stat-label">磁盘水位</div>
            <div className="ch-stat-value num">{diskPct.toFixed(1)}%</div>
            <div style={{ marginTop: 8 }}>
              <StorageMeter
                usedBytes={status.disk.recordings_bytes}
                maxGb={status.disk.max_gb}
                showLabel={false}
              />
            </div>
            <div className="ch-stat-sub num">
              {formatBytes(status.disk.recordings_bytes)} / {status.disk.max_gb} GB
            </div>
          </div>

          <div className="ch-stat-cell">
            <div className="ch-stat-label">运行时长</div>
            <div className="ch-stat-value num">{formatDuration(status.uptime_sec)}</div>
            <div className="ch-stat-sub num">累计事件 {status.events_count} 条</div>
          </div>

          <div className="ch-stat-cell">
            <div className="ch-stat-label">自检状态</div>
            <div className="ch-stat-value" style={{ color: sc.color }}>
              <span className={`ch-status-dot ${sc.dot}`} />
              {sc.text}
            </div>
            <div className="ch-stat-sub num">
              {status.selfcheck.enabled
                ? `上次 ${formatTime(status.selfcheck.last_run)}`
                : '未启用画面自检'}
            </div>
          </div>
        </div>
      </Panel>

      <div className="ch-split">
        <Panel
          title="今日事件趋势"
          extra={<span className="ch-muted num">{timeline.date}</span>}
        >
          <HourlyChart hourly={timeline.hourly} date={timeline.date} />
        </Panel>

        <Panel
          title="最新事件"
          extra={
            <Tooltip content="前往事件中心">
              <a className="ch-muted" href="#/events">
                全部
              </a>
            </Tooltip>
          }
        >
          {events.items.length === 0 ? (
            <EmptyState title="今日暂无事件" description="有移动侦测或画面异常时，这里会出现最新记录。" />
          ) : (
            <div className="ch-event-list">
              {events.items.map((e) => (
                <div className="ch-event-row" key={e.id}>
                  <img
                    className="ch-event-thumb"
                    src={mediaUrl(e.image)}
                    alt={`${eventTypeLabel(e.type, e.detail)} 快照`}
                    loading="lazy"
                  />
                  <div className="ch-event-main">
                    <div className="ch-event-title">
                      {eventTypeLabel(e.type, e.detail)}
                      {e.type === 'motion' ? (
                        <span className="num ch-muted"> · 得分 {e.score}</span>
                      ) : null}
                    </div>
                    <div className="ch-event-sub num">{formatDateTime(e.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
