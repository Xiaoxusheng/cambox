/**
 * / 监控（默认路由，v1.2 契约 §4.2）
 * 画面是视觉主体：16:9 contain 占满可用高度，不出滚动条；下方一行状态细条（不是卡片）；
 * 右侧（桌面）或下方（移动）最近事件流。ROI 编辑收进弹层；布防开关在顶部栏，此处不重复。
 */
import { useState } from 'react'
import { Button, Message, Modal } from '@arco-design/web-react'
import { IconCamera, IconEdit, IconRefresh } from '@arco-design/web-react/icon'
import { fetchEvents, fetchStatus, manualSnapshot } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Event, EventsResponse, Status } from '../api/types'
import { Panel } from '../components/Panel'
import { RoiEditorModal } from '../components/RoiEditorModal'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { useStreamFrame } from '../hooks/useStreamFrame'
import { eventTypeLabel, formatBytes, formatDateTime, selfCheckView } from '../utils/format'

const GB = 1024 ** 3

type MonitorData = [Status, EventsResponse]

export function MonitorPage() {
  const { data, loading, error, reload } = useAsync<MonitorData>(
    (signal) =>
      Promise.all([fetchStatus(signal), fetchEvents({ limit: 8, offset: 0 }, signal)]),
    [],
    { pollMs: 5000 },
  )
  const frame = useStreamFrame(true)
  const [snapBusy, setSnapBusy] = useState(false)
  const [shot, setShot] = useState<{ file: string; url: string } | null>(null)
  const [roiOpen, setRoiOpen] = useState(false)
  const [preview, setPreview] = useState<Event | null>(null)

  const doSnapshot = async () => {
    setSnapBusy(true)
    try {
      const res = await manualSnapshot()
      setShot(res)
      Message.success(`已抓拍并保存：${res.file}`)
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setSnapBusy(false)
    }
  }

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const [status, events] = data
  const cam = status.camera
  const connected = cam.connected
  const diskPct = Math.min(
    100,
    (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * GB)) * 100,
  )
  const sc = selfCheckView(status.selfcheck)
  const maskText = frame.failed
    ? '实时画面加载失败，请检查相机连接后重试'
    : !connected
      ? '摄像头未连接，正在等待取流'
      : ''

  return (
    <div className="ch-monitor">
      <div className="ch-monitor-main">
        <div className="ch-monitor-video">
          {frame.src ? (
            <img
              className="ch-monitor-frame"
              src={frame.src}
              alt="实时画面"
              onError={frame.markFailed}
            />
          ) : null}
          {frame.src ? (
            <span className="ch-stream-fps num">{cam.fps.toFixed(1)} fps</span>
          ) : null}
          {maskText ? (
            <div className="ch-stream-mask">
              <span className={`ch-status-dot ${frame.failed ? 'err' : 'warn'}`} />
              <div>{maskText}</div>
              <Button size="small" onClick={frame.retry}>
                重试
              </Button>
            </div>
          ) : null}
        </div>

        <div className="ch-statusbar">
          <span className="ch-statusbar-item">
            <span className={`ch-status-dot ${connected ? 'ok' : 'err'}`} />
            {connected ? '在线' : '离线'}
          </span>
          <span className="ch-statusbar-item num">{cam.fps.toFixed(1)} fps</span>
          <span className="ch-statusbar-item num ch-hide-mobile">
            {cam.width}×{cam.height}
          </span>
          <span className="ch-statusbar-item">
            {status.recorder.running
              ? '录像中'
              : status.recorder.enabled
                ? '待机'
                : '录像已关闭'}
          </span>
          <span
            className="ch-statusbar-item ch-statusbar-meter"
            title={`录像占用 ${formatBytes(status.disk.recordings_bytes)} / 上限 ${status.disk.max_gb} GB`}
          >
            <span className="ch-meter">
              <span
                className="ch-meter-fill"
                style={{
                  width: `${diskPct}%`,
                  background:
                    diskPct >= 90
                      ? 'var(--ch-danger)'
                      : diskPct >= 75
                        ? 'var(--ch-warn)'
                        : 'var(--ch-primary)',
                }}
              />
            </span>
            <span className="num">{diskPct.toFixed(0)}%</span>
          </span>
          <span className="ch-statusbar-item ch-hide-mobile">
            <span className={`ch-status-dot ${sc.dot}`} style={{ color: sc.color }} />
            自检 {sc.text}
          </span>
          <span className="ch-statusbar-item num">事件 {status.events_count}</span>
          {error ? (
            <span className="ch-statusbar-item" style={{ color: 'var(--ch-danger)' }}>
              刷新失败
            </span>
          ) : null}
          <span className="ch-statusbar-spacer" />
          <Button size="mini" icon={<IconCamera />} loading={snapBusy} onClick={doSnapshot}>
            抓拍
          </Button>
          <Button size="mini" icon={<IconEdit />} onClick={() => setRoiOpen(true)}>
            检测区域
          </Button>
          <Button size="mini" icon={<IconRefresh />} aria-label="刷新数据" onClick={reload} />
        </div>
      </div>

      <Panel
        title="最近事件"
        className="ch-monitor-events"
        extra={
          <a className="ch-muted" href="#/events">
            全部
          </a>
        }
        bodyStyle={{ padding: 'var(--ch-space-sm) var(--ch-space-md)' }}
      >
        {events.items.length === 0 ? (
          <EmptyState
            title="暂无事件"
            description="布防后有移动侦测或画面异常时，这里会出现最新记录。"
          />
        ) : (
          <div className="ch-event-list">
            {events.items.map((e) => (
              <button
                type="button"
                className="ch-event-row ch-event-row-btn"
                key={e.id}
                onClick={() => setPreview(e)}
                aria-label={`查看 ${formatDateTime(e.time)} 的${eventTypeLabel(e.type, e.detail)}`}
              >
                <img className="ch-event-thumb" src={mediaUrl(e.image)} alt="" loading="lazy" />
                <span className="ch-event-main">
                  <span className="ch-event-title">
                    {eventTypeLabel(e.type, e.detail)}
                    {e.type === 'motion' ? (
                      <span className="num ch-muted"> · 得分 {e.score}</span>
                    ) : null}
                  </span>
                  <span className="ch-event-sub num">{formatDateTime(e.time)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <RoiEditorModal visible={roiOpen} onCancel={() => setRoiOpen(false)} />

      <Modal
        visible={!!shot}
        title="抓拍结果"
        footer={<Button onClick={() => setShot(null)}>关闭</Button>}
        onCancel={() => setShot(null)}
        autoFocus={false}
      >
        {shot ? (
          <>
            <img
              src={mediaUrl(shot.url)}
              alt="抓拍画面"
              style={{ width: '100%', borderRadius: 8, display: 'block' }}
            />
            <div className="ch-muted" style={{ marginTop: 8 }}>
              文件：{shot.file}
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        visible={!!preview}
        title={
          preview ? `${eventTypeLabel(preview.type, preview.detail)} · ${formatDateTime(preview.time)}` : ''
        }
        footer={null}
        onCancel={() => setPreview(null)}
        autoFocus={false}
      >
        {preview ? (
          <img
            src={mediaUrl(preview.image)}
            alt="事件快照"
            style={{ width: '100%', borderRadius: 8, display: 'block' }}
          />
        ) : null}
      </Modal>
    </div>
  )
}
