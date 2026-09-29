/**
 * /dashboard 概览 —— Arco 组件原生实现。
 * 信息层级：① 六张状态卡（Card + Statistic/Tag/Progress/Switch）
 * ② 今日事件趋势（HourlyChart） ③ 最新事件（EventList）。
 */
import { useState } from 'react'
import { Button, Card, Grid, Message, Progress, Space, Statistic, Switch, Tag, Typography } from '@arco-design/web-react'
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
const { Text } = Typography
const { Row, Col } = Grid

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

  const diskColor = diskPct >= 90 ? '--color-danger-6' : diskPct >= 75 ? '--color-warning-6' : '--color-primary-6'

  return (
    <>
      <PageHeader
        title="概览"
        description={
          <>
            数据时间 {formatTime(status.time)} · 每 5 秒自动刷新
            {error ? <Text type="error"> · 刷新失败：{error}</Text> : null}
          </>
        }
        actions={
          <Button type="outline" icon={<IconRefresh />} loading={loading} onClick={reload}>
            刷新
          </Button>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={12} sm={12} md={8} lg={8} xl={4}>
          <Card size="small" title="连接" hoverable>
            <Statistic
              value={cam.connected ? '已连接' : '未连接'}
              styleValue={cam.connected ? undefined : { color: 'rgb(var(--danger-6))' }}
            />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {cam.type.toUpperCase()} · {cam.fps.toFixed(1)} FPS
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={8} lg={8} xl={4}>
          <Card size="small" title="录像" hoverable>
            <Space align="center">
              <Tag color={status.recorder.running ? 'red' : 'gray'} size="small">
                {status.recorder.running ? '录像中' : '已停止'}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {status.recorder.enabled ? modeLabel : '配置已关闭'}
              </Text>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                {status.recorder.current_file || '等待分段'}
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={8} lg={8} xl={4}>
          <Card size="small" title="布防" hoverable>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Tag color={status.armed ? 'arcoblue' : 'gray'} size="small">
                {status.armed ? '布防中' : '已撤防'}
              </Tag>
              <Switch
                size="small"
                checked={status.armed}
                loading={armPending}
                onChange={toggleArm}
                aria-label="布防开关"
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                日程 · 侦测 {status.schedule_active.motion ? '开' : '关'} / 录像{' '}
                {status.schedule_active.record ? '开' : '关'}
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={8} lg={8} xl={4}>
          <Card size="small" title="磁盘水位" hoverable>
            <Statistic value={diskPct.toFixed(1)} suffix="%" />
            <Progress
              percent={diskPct}
              showText={false}
              size="small"
              style={{ marginTop: 8 }}
              color={`rgb(var(${diskColor}))`}
              aria-label={`磁盘使用率 ${diskPct.toFixed(1)}%`}
            />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatGB(status.disk.recordings_bytes)} / {status.disk.max_gb} GB
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={8} lg={8} xl={4}>
          <Card size="small" title="运行时长" hoverable>
            <Statistic value={formatUptime(status.uptime_sec)} />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                累计事件 {status.events_count} 条
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={8} lg={8} xl={4}>
          <Card size="small" title="自检状态" hoverable>
            <Tag color={sc.dot === 'ok' ? 'green' : sc.dot === 'warn' ? 'orange' : 'red'} size="small">
              {sc.text}
            </Tag>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {status.selfcheck.enabled ? `上次 ${formatTime(status.selfcheck.last_run)}` : '未启用画面自检'}
              </Text>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={12} style={{ marginTop: 12 }}>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title={
              <span>
                <IconDashboard style={{ marginRight: 8, verticalAlign: -2 }} />
                今日事件趋势
              </span>
            }
            extra={<Tag size="small">{timeline.date}</Tag>}
          >
            <Space size={6} style={{ marginBottom: 12 }}>
              <Tag size="small" color="arcoblue">
                移动侦测
              </Tag>
              <Tag size="small" color="orange">
                画面自检
              </Tag>
            </Space>
            <HourlyChart hourly={timeline.hourly} selfcheck={selfcheckHourly} date={timeline.date} height={252} />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={
              <span>
                <IconNotification style={{ marginRight: 8, verticalAlign: -2 }} />
                最新事件
              </span>
            }
            extra={
              <Button type="text" size="small" onClick={() => (window.location.hash = '#/events')}>
                全部
              </Button>
            }
            bodyStyle={{ maxHeight: 420, overflow: 'auto' }}
          >
            <EventList items={events} cameraName={cam.name} />
          </Card>
        </Col>
      </Row>
    </>
  )
}
