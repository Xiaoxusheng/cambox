/**
 * / 监控（默认路由，v1.3 按 camhub-ui-4k/01 设计稿重做）
 * 画面是视觉主体：LIVE 遮罩 + 分辨率 chip + ROI 虚线覆盖 + 底部玻璃状态条；
 * 右侧（桌面）或下方（移动）实时事件流。ROI 编辑收进弹层；布防开关在顶部栏。
 * 检测 bbox 后端未暴露，不做叠加；ROI 覆盖对齐实际渲染的图像矩形（contain 适配）。
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Message, Modal } from '@arco-design/web-react'
import { fetchConfig, fetchEvents, fetchStatus, fetchTimeline, manualSnapshot } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Config, Event, EventsResponse, Status, TimelineData } from '../api/types'
import { EventList } from '../components/EventList'
import { RoiEditorModal } from '../components/RoiEditorModal'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { useStreamFrame } from '../hooks/useStreamFrame'
import { formatBytes, formatClockFull, toLocalDateStr } from '../utils/format'

const GB = 1024 ** 3

type MonitorData = [Status, EventsResponse]

/** 画面左上角的实时时钟（本地时间，秒级跳动） */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="num">{formatClockFull(now)}</span>
}

/** object-fit: contain 后图像实际渲染的矩形（ROI 覆盖对齐用） */
function useContainedRect(
  ref: React.RefObject<HTMLDivElement | null>,
  imgW: number,
  imgH: number,
): { left: number; top: number; width: number; height: number } {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || imgW <= 0 || imgH <= 0) return
    const compute = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (cw <= 0 || ch <= 0) return
      const ar = imgW / imgH
      let w = cw
      let h = w / ar
      if (h > ch) {
        h = ch
        w = h * ar
      }
      setRect({ left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h })
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, imgW, imgH])
  return rect
}

export function MonitorPage() {
  const { data, loading, error, reload } = useAsync<MonitorData>(
    (signal) => Promise.all([fetchStatus(signal), fetchEvents({ limit: 8, offset: 0 }, signal)]),
    [],
    { pollMs: 5000 },
  )
  // ROI 覆盖与「今日 N 条」：初始加载一次即可
  const { data: config } = useAsync<Config>((signal) => fetchConfig(signal), [])
  const today = toLocalDateStr(new Date())
  const { data: timeline } = useAsync<TimelineData>((signal) => fetchTimeline(today, signal), [today])
  const frame = useStreamFrame(true)
  const [snapBusy, setSnapBusy] = useState(false)
  const [shot, setShot] = useState<{ file: string; url: string } | null>(null)
  const [roiOpen, setRoiOpen] = useState(false)
  const [preview, setPreview] = useState<Event | null>(null)
  const videoBoxRef = useRef<HTMLDivElement>(null)
  // 画面矩形 = contain 后的图像区域（解码输出宽高比即 camera.width/height）
  const camW = data?.[0].camera.width ?? 0
  const camH = data?.[0].camera.height ?? 0
  const fitRect = useContainedRect(videoBoxRef, camW, camH)

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

  const fullscreen = () => {
    const el = videoBoxRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => Message.error('当前浏览器不允许全屏'))
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
  const rois = config?.motion.rois ?? []
  const todayCount = timeline ? timeline.hourly.reduce((a, b) => a + b, 0) : null
  const maskText = frame.failed
    ? '实时画面加载失败，请检查相机连接后重试'
    : !connected
      ? '摄像头未连接，正在等待取流'
      : ''

  return (
    <div className="ch-monitor">
      <div className="ch-monitor-main" ref={videoBoxRef}>
        {frame.src ? (
          <>
            <img
              className="ch-monitor-frame"
              src={frame.src}
              alt="实时画面"
              onError={frame.markFailed}
            />
            {rois.length > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  left: fitRect.left,
                  top: fitRect.top,
                  width: fitRect.width,
                  height: fitRect.height,
                  pointerEvents: 'none',
                }}
              >
                {rois.map((r, i) => (
                  <div
                    key={i}
                    className="ch-roiovl"
                    style={{
                      left: `${r[0] * 100}%`,
                      top: `${r[1] * 100}%`,
                      width: `${r[2] * 100}%`,
                      height: `${r[3] * 100}%`,
                    }}
                  >
                    <span className="ch-roiovl-tag">ROI {i + 1}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {maskText ? (
          <div className="ch-stream-mask">
            <span className={`ch-status-dot ${frame.failed ? 'err' : 'warn'}`} />
            <div>{maskText}</div>
            <Button size="small" onClick={frame.retry}>
              重试
            </Button>
          </div>
        ) : (
          <span className="ch-ovl tl">
            <span className="ch-live-dot" />
            <span className="ch-live-text">LIVE</span>
            <LiveClock />
          </span>
        )}

        {frame.src ? (
          <span className="ch-ovl tr num">
            {cam.width}×{cam.height} · {cam.fps.toFixed(1)} FPS
          </span>
        ) : null}

        <div className="ch-livebar">
          <span className="ch-livebar-item">
            <span className={`ch-status-dot ${connected ? 'ok' : 'err'}`} />
            {connected ? '在线' : '离线'}
          </span>
          <span className="ch-livebar-item num ch-topbar-fps">{cam.fps.toFixed(1)} FPS</span>
          <span className="ch-livebar-item num ch-hide-mobile">
            {cam.width}×{cam.height}
          </span>
          <span className="ch-livebar-item">
            {status.recorder.running ? (
              <>
                <span className="ch-status-dot err" />
                录像中
              </>
            ) : status.recorder.enabled ? (
              '待机'
            ) : (
              '录像已关闭'
            )}
          </span>
          <span
            className="ch-livebar-item ch-hide-mobile"
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
            <span className="num">
              {(status.disk.recordings_bytes / GB).toFixed(1)} / {status.disk.max_gb} GB
            </span>
          </span>
          {error ? (
            <span className="ch-livebar-item" style={{ color: 'var(--ch-danger)' }}>
              刷新失败
            </span>
          ) : null}
          <span className="ch-livebar-spacer" />
          <button type="button" className="ch-btn sm" disabled={snapBusy} onClick={doSnapshot}>
            {snapBusy ? '抓拍中…' : '抓拍'}
          </button>
          <button type="button" className="ch-btn sm" onClick={() => setRoiOpen(true)}>
            检测区域
          </button>
          <button type="button" className="ch-btn sm ch-hide-mobile" onClick={fullscreen}>
            全屏
          </button>
        </div>
      </div>

      <section className="ch-panel ch-monitor-events">
        <header className="ch-panel-head">
          <div className="ch-panel-title">实时事件</div>
          <div className="ch-panel-extra">
            {todayCount !== null ? <span className="ch-badge cyan num">今日 {todayCount}</span> : null}
          </div>
        </header>
        <div className="ch-panel-body">
          <EventList items={events.items} cameraName={cam.name} onItemClick={setPreview} />
        </div>
        {events.items.length > 0 ? (
          <footer className="ch-monitor-events-footer">
            <a className="ch-linkbtn" href="#/events">
              查看全部事件
            </a>
          </footer>
        ) : null}
      </section>

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
          preview
            ? `${preview.type === 'motion' ? `移动侦测 · 得分 ${preview.score}` : preview.detail === 'frozen' ? '画面冻结' : '画面异常'}`
            : ''
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
