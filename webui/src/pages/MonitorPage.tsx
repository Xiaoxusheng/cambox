/**
 * / 监控（默认路由）—— Arco 组件原生实现。
 * 画面是视觉主体：Card 包裹 MJPEG 流 + Tag 浮层 + ROI 覆盖；工具条用 Space+Button；
 * 实时事件用 Drawer（mask=false，滑入/滑出为组件自带动画）。ROI 编辑收进弹层；布防开关在顶部栏。
 * 检测 bbox 后端未暴露，不做叠加；ROI 覆盖对齐实际渲染的图像矩形（cover 适配）。
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Drawer, Message, Modal, Progress, Space, Spin, Tag, Tooltip, Typography } from '@arco-design/web-react'
import { IconDoubleLeft, IconDoubleRight, IconExpand, IconCamera } from '@arco-design/web-react/icon'
import { fetchConfig, fetchEvents, fetchStatus, fetchTimeline, manualSnapshot } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, mediaUrl } from '../api/media'
import type { Config, Event, EventsResponse, Status, TimelineData } from '../api/types'
import { AutoCropImage, detectContentBox, type ContentBox } from '../components/AutoCropImage'
import { EventList } from '../components/EventList'
import { RoiEditorModal } from '../components/RoiEditorModal'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { useStreamFrame } from '../hooks/useStreamFrame'
import { formatBytes, formatClockFull, toLocalDateStr } from '../utils/format'

const GB = 1024 ** 3
const { Text } = Typography

type MonitorData = [Status, EventsResponse]

/** 画面左上角的实时时钟（本地时间，秒级跳动） */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="ch-num">{formatClockFull(now)}</span>
}

/** object-fit: cover 后图像实际渲染的矩形（ROI 覆盖对齐用） */
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
      // cover：铺满容器、溢出裁边（全出血监控画面），ROI 覆盖仍按图像矩形映射
      let w = cw
      let h = w / ar
      if (h < ch) {
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
  // 实时事件面板收起/呼出（持久化；Drawer 滑入滑出为组件自带动画）
  const [eventsOpen, setEventsOpen] = useState(() => localStorage.getItem('camhub-events-open') !== '0')
  const toggleEvents = (next: boolean) => {
    localStorage.setItem('camhub-events-open', next ? '1' : '0')
    setEventsOpen(next)
  }
  const videoBoxRef = useRef<HTMLDivElement>(null)
  // 画面矩形 = cover 后的图像区域（解码输出宽高比即 camera.width/height）
  const camW = data?.[0].camera.width ?? 0
  const camH = data?.[0].camera.height ?? 0
  // 直播流内嵌黑边裁切（宽画幅测试流）：后台周期检测，首次检出黑边即采用
  const [liveBox, setLiveBox] = useState<ContentBox | null>(null)
  useEffect(() => {
    if (IS_MOCK) return
    const timer = window.setInterval(() => {
      const img = document.querySelector<HTMLImageElement>('.ch-monitor-frame')
      if (!img || !img.naturalWidth) return
      try {
        const b = detectContentBox(img)
        if (b) setLiveBox((prev) => prev ?? b) // 首次检出生效，此后保持稳定
      } catch {
        /* 画面未就绪时跳过本轮 */
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])
  // 裁黑边后的有效画面宽高比（ROI 覆盖对齐用）
  const effW = liveBox ? (liveBox.x1 - liveBox.x0) * camW : camW
  const effH = liveBox ? (liveBox.y1 - liveBox.y0) * camH : camH
  const fitRect = useContainedRect(videoBoxRef, effW, effH)

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
      <Card
        size="small"
        bodyStyle={{ padding: 0, position: 'relative', overflow: 'hidden' }}
        className="ch-video-card"
      >
        <div className="ch-video-box" ref={videoBoxRef}>
          {frame.src ? (
            <>
              <img
                className="ch-monitor-frame"
                src={frame.src}
                alt="实时画面"
                onError={frame.markFailed}
                style={
                  liveBox
                    ? ({
                        // 只显示内容区，黑边裁掉；object-fit: cover 继续负责铺满容器
                        objectViewBox: `inset(${(liveBox.y0 * 100).toFixed(2)}% ${((1 - liveBox.x1) * 100).toFixed(2)}% ${((1 - liveBox.y1) * 100).toFixed(2)}% ${(liveBox.x0 * 100).toFixed(2)}%)`,
                      } as React.CSSProperties)
                    : undefined
                }
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
                    overflow: 'hidden',
                  }}
                >
                  {rois.map((r, i) => {
                    // ROI 坐标归一化于完整帧；裁黑边显示时重映射到内容区坐标系
                    const [rx, ry, rw, rh] = liveBox
                      ? [
                          (r[0] - liveBox.x0) / (liveBox.x1 - liveBox.x0),
                          (r[1] - liveBox.y0) / (liveBox.y1 - liveBox.y0),
                          r[2] / (liveBox.x1 - liveBox.x0),
                          r[3] / (liveBox.y1 - liveBox.y0),
                        ]
                      : r
                    return (
                      <div
                        key={i}
                        className="ch-roiovl"
                        style={{
                          left: `${rx * 100}%`,
                          top: `${ry * 100}%`,
                          width: `${rw * 100}%`,
                          height: `${rh * 100}%`,
                        }}
                      >
                        <Tag size="small" color="cyan" style={{ position: 'absolute', left: 4, top: 4 }}>
                          ROI {i + 1}
                        </Tag>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </>
          ) : null}

          {maskText ? (
            <div className="ch-stream-mask">
              <Spin dot size={24} />
              <div>{maskText}</div>
              <Button size="small" type="outline" onClick={frame.retry}>
                重试
              </Button>
            </div>
          ) : (
            <div className="ch-ovl tl">
              <Tag color="red" size="small">
                LIVE
              </Tag>
              <Text style={{ color: '#fff', fontSize: 12, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                <LiveClock />
              </Text>
            </div>
          )}

          {frame.src ? (
            <div className="ch-ovl tr">
              <Tag size="small" color="black">
                {cam.width}×{cam.height} · {cam.fps.toFixed(1)} FPS
              </Tag>
            </div>
          ) : null}

          {!eventsOpen ? (
            <Button
              type="outline"
              size="small"
              icon={<IconDoubleLeft />}
              className="ch-events-fab"
              onClick={() => toggleEvents(true)}
              aria-label="打开实时事件面板"
            >
              实时事件{todayCount !== null ? ` · ${todayCount}` : ''}
            </Button>
          ) : null}
        </div>
      </Card>

      {/* 工具条：状态 Tag + 磁盘水位 + 操作按钮 */}
      <Card size="small" bodyStyle={{ padding: '10px 16px' }} style={{ marginTop: 12 }}>
        <Space size={16} align="center" wrap>
          <Tag color={connected ? 'green' : 'red'} size="small">
            {connected ? '在线' : '离线'}
          </Tag>
          <Tag color={status.recorder.running ? 'red' : 'gray'} size="small">
            {status.recorder.running ? '录像中' : status.recorder.enabled ? '待机' : '录像已关闭'}
          </Tag>
          <Text type="secondary" className="ch-num ch-hide-mobile">
            {cam.fps.toFixed(1)} FPS · {cam.width}×{cam.height}
          </Text>
          <Tooltip content={`录像占用 ${formatBytes(status.disk.recordings_bytes)} / 上限 ${status.disk.max_gb} GB`}>
            <span className="ch-hide-mobile" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Progress
                percent={diskPct}
                showText={false}
                size="small"
                style={{ width: 120 }}
                color={
                  diskPct >= 90
                    ? 'rgb(var(--danger-6))'
                    : diskPct >= 75
                      ? 'rgb(var(--warning-6))'
                      : 'rgb(var(--primary-6))'
                }
              />
              <Text type="secondary" className="ch-num" style={{ fontSize: 12 }}>
                {(status.disk.recordings_bytes / GB).toFixed(1)} / {status.disk.max_gb} GB
              </Text>
            </span>
          </Tooltip>
          {error ? <Text type="error">刷新失败</Text> : null}
          <Button type="primary" size="small" icon={<IconCamera />} loading={snapBusy} onClick={doSnapshot}>
            抓拍
          </Button>
          <Button type="outline" size="small" onClick={() => setRoiOpen(true)}>
            检测区域
          </Button>
          <Button type="outline" size="small" icon={<IconExpand />} className="ch-hide-mobile" onClick={fullscreen}>
            全屏
          </Button>
        </Space>
      </Card>

      {/* 实时事件：右侧抽屉（mask=false 不遮挡画面，滑入动画为组件自带） */}
      <Drawer
        visible={eventsOpen}
        placement="right"
        width={380}
        mask={false}
        wrapClassName="ch-events-drawer"
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            实时事件{todayCount !== null ? ` · 今日 ${todayCount}` : ''}
            <Button
              type="text"
              size="small"
              icon={<IconDoubleRight />}
              onClick={() => toggleEvents(false)}
              aria-label="收起实时事件面板"
            />
          </span>
        }
        footer={
          events.items.length > 0 ? (
            <Button type="text" size="small" long onClick={() => (window.location.hash = '#/events')}>
              查看全部事件
            </Button>
          ) : null
        }
        onCancel={() => toggleEvents(false)}
      >
        <EventList items={events.items} cameraName={cam.name} onItemClick={setPreview} />
      </Drawer>

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
            <AutoCropImage src={mediaUrl(shot.url)} alt="抓拍画面" />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">文件：{shot.file}</Text>
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
        {preview ? <AutoCropImage src={mediaUrl(preview.image)} alt="事件快照" /> : null}
      </Modal>
    </div>
  )
}
