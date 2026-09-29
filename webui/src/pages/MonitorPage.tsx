/**
 * / 监控 —— CamBox Camera Workspace（v1.4 Linear-style 重构，任务书 §21~31）。
 *
 * 布局（xl+）：
 *   ┌────────────────────────────────────┬──────────────┐
 *   │  CameraViewport（黑底 contain 主角）│ Recent       │
 *   │  HUD：LIVE/时钟 · 分辨率·FPS · REC │ Events       │
 *   ├────────────────────────────────────┤ 320px 栏     │
 *   │  单行状态（在线·FPS·分辨率·存储）  │              │
 *   └────────────────────────────────────┴──────────────┘
 * <xl：事件栏转为视口下方区块；移动端工具条常驻不依赖 hover。
 * ROI 覆盖只在「启用编辑」时显示（任务书 §26），坐标按 contain 公式对齐实际渲染矩形。
 * 功能零丢失：5s 轮询 / 黑边检测 / 抓拍 / ROI 弹层 / 事件预览 / 全屏 / 今日计数 全部保留。
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Message, Modal, Tooltip } from '@arco-design/web-react'
import { IconCamera, IconExpand } from '@arco-design/web-react/icon'
import { Link } from 'react-router-dom'
import { fetchConfig, fetchEvents, fetchStatus, fetchTimeline, manualSnapshot } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, mediaUrl } from '../api/media'
import type { Config, Event, Status, TimelineData } from '../api/types'
import { detectContentBox, type ContentBox } from '../components/AutoCropImage'
import { EventList } from '../components/EventList'
import { RoiEditorModal } from '../components/RoiEditorModal'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useStreamFrame } from '../hooks/useStreamFrame'
import { formatClockFull, toLocalDateStr } from '../utils/format'
import { cx } from '../utils/cx'

type MonitorData = [Status, { items: Event[]; total: number }]

/** 画面左上角实时时钟（本地时间，秒级跳动；mono + tabular-nums，不加动画） */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="cam-num">{formatClockFull(now)}</span>
}

/**
 * object-fit: contain 后图像实际渲染的矩形（ROI 覆盖对齐用）。
 * contain = 短边贴满、长边留黑边；不裁切主画面。
 */
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

/** HUD 信息条：小号 mono + 低对比，玻璃拟态仅限此处（任务书 §24） */
function HudChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'cam-num inline-flex h-6 items-center gap-1.5 rounded-md bg-black/45 px-2 text-caption backdrop-blur-md',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** 悬浮工具条按钮（hover 克制：bg 变化 150ms，禁 scale；aria-label 必备） */
function HudButton({
  icon,
  label,
  onClick,
  disabled = false,
  loading = false,
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || loading}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-body-secondary font-medium',
        'text-white/75 transition-colors duration-150 ease-cam',
        'hover:bg-white/10 hover:text-white',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/40 border-t-transparent" />
      ) : (
        icon
      )}
      {label}
    </button>
  )
}

export function MonitorPage() {
  const { data, loading, error, reload } = useAsync<MonitorData>(
    (signal) => Promise.all([fetchStatus(signal), fetchEvents({ limit: 12, offset: 0 }, signal)]),
    [],
    { pollMs: 5000 },
  )
  // ROI 编辑与「今日 N 条」：初始加载一次即可
  const { data: config } = useAsync<Config>((signal) => fetchConfig(signal), [])
  const today = toLocalDateStr(new Date())
  const { data: timeline } = useAsync<TimelineData>((signal) => fetchTimeline(today, signal), [today])
  const frame = useStreamFrame(true)
  const isNarrow = useMediaQuery('(max-width: 1279px)')
  const [snapBusy, setSnapBusy] = useState(false)
  const [shot, setShot] = useState<{ file: string; url: string } | null>(null)
  const [roiOpen, setRoiOpen] = useState(false)
  const [preview, setPreview] = useState<Event | null>(null)
  const videoBoxRef = useRef<HTMLDivElement>(null)
  // 画面矩形 = contain 后的图像区域（解码输出宽高比即 camera.width/height）
  const camW = data?.[0].camera.width ?? 0
  const camH = data?.[0].camera.height ?? 0
  // 直播流内嵌黑边裁切（宽画幅测试流）：后台周期检测，首次检出黑边即采用
  const [liveBox, setLiveBox] = useState<ContentBox | null>(null)
  useEffect(() => {
    if (IS_MOCK) return
    const timer = window.setInterval(() => {
      const img = document.querySelector<HTMLImageElement>('.cam-monitor-frame')
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
  const recording = status.recorder.running
  const diskPct = Math.min(
    100,
    (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * 1024 ** 3)) * 100,
  )
  const rois = config?.motion.rois ?? []
  const todayCount = timeline ? timeline.hourly.reduce((a, b) => a + b, 0) : null
  const maskText = frame.failed
    ? '实时画面加载失败，请检查相机连接后重试'
    : !connected
      ? '摄像头未连接，正在等待取流'
      : ''

  const eventsRail = (
    <div
      className={cx(
        'flex min-h-0 flex-col',
        isNarrow
          ? 'border-t border-cam-border'
          : 'w-[320px] shrink-0 border-l border-cam-border',
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-1 pt-3.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-section-title text-cam-text-primary">最近事件</h2>
          {todayCount !== null ? (
            <span className="cam-num text-caption text-cam-text-tertiary">今日 {todayCount}</span>
          ) : null}
        </div>
        <Link
          to="/events"
          className="shrink-0 text-caption text-cam-text-secondary no-underline transition-colors duration-150 ease-cam hover:text-cam-text-primary"
        >
          全部 →
        </Link>
      </div>
      <div className={cx('min-h-0 flex-1 overflow-y-auto p-2', isNarrow && 'max-h-[420px]')}>
        <EventList items={events.items} cameraName={cam.name} onItemClick={setPreview} />
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col xl:flex-row">
      {/* ---------- 左主区：视口 + 单行状态 ---------- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 md:p-4">
        {/* 视口：直接作为主 Surface（黑底 contain），不套 Panel（任务书 §23） */}
        <div
          ref={videoBoxRef}
          className="group relative min-h-0 flex-1 overflow-hidden rounded-lg border border-cam-border bg-black"
        >
          {frame.src ? (
            <>
              <img
                className="cam-monitor-frame"
                src={frame.src}
                alt="实时画面"
                onError={frame.markFailed}
                style={
                  liveBox
                    ? ({
                        objectViewBox: `inset(${(liveBox.y0 * 100).toFixed(2)}% ${((1 - liveBox.x1) * 100).toFixed(2)}% ${((1 - liveBox.y1) * 100).toFixed(2)}% ${(liveBox.x0 * 100).toFixed(2)}%)`,
                      } as React.CSSProperties)
                    : undefined
                }
              />
              {/* ROI 覆盖：只在启用编辑（弹层打开）时显示（任务书 §26） */}
              {roiOpen && rois.length > 0 ? (
                <div
                  className="pointer-events-none absolute overflow-hidden"
                  style={{
                    left: fitRect.left,
                    top: fitRect.top,
                    width: fitRect.width,
                    height: fitRect.height,
                  }}
                >
                  {rois.map((r, i) => {
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
                        className="cam-roiovl"
                        style={{
                          left: `${rx * 100}%`,
                          top: `${ry * 100}%`,
                          width: `${rw * 100}%`,
                          height: `${rh * 100}%`,
                        }}
                      >
                        <span className="cam-roiovl-tag">ROI {i + 1}</span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </>
          ) : null}

          {/* 离线 / 加载失败态：发生了什么 + 怎么办 */}
          {maskText ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 px-6 text-center backdrop-blur-sm">
              <IconCamera style={{ fontSize: 26 }} className="text-cam-text-tertiary" />
              <div className="max-w-[420px] text-body text-white/90">{maskText}</div>
              <Button size="small" type="outline" onClick={frame.retry}>
                重试
              </Button>
            </div>
          ) : (
            <>
              {/* HUD：仅 LIVE + 时钟（分辨率/FPS/录像状态在底部状态行，不重复，任务书 §55） */}
              <div className="cam-hud absolute left-3.5 top-3.5 z-10 flex flex-col items-start gap-1.5">
                <HudChip className="font-semibold tracking-[0.14em] text-white/85">
                  <span className="h-1.5 w-1.5 animate-rec-pulse rounded-full bg-cam-rec" />
                  LIVE
                </HudChip>
                <HudChip className="!text-white/70">
                  <LiveClock />
                </HudChip>
              </div>
              {/* HUD 左下：REC（录像中才出现，克制红点不发光） */}
              {recording ? (
                <div className="cam-hud absolute bottom-3.5 left-3.5 z-10">
                  <HudChip className="text-cam-rec">
                    <span className="h-1.5 w-1.5 animate-rec-pulse rounded-full bg-current" />
                    REC
                  </HudChip>
                </div>
              ) : null}
            </>
          )}

          {/* 悬浮工具条：hover 浮现（xl+），<xl 常驻；键盘 focus-within 同样浮现 */}
          {!maskText ? (
            <div
              className={cx(
                'absolute inset-x-0 bottom-4 z-20 flex justify-center px-4',
                'transition-all duration-200 ease-cam',
                'xl:pointer-events-none xl:translate-y-1 xl:opacity-0',
                'xl:group-hover:pointer-events-auto xl:group-hover:translate-y-0 xl:group-hover:opacity-100',
                'xl:focus-within:pointer-events-auto xl:focus-within:translate-y-0 xl:focus-within:opacity-100',
              )}
            >
              <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur-xl">
                <HudButton
                  icon={<IconCamera style={{ fontSize: 14 }} />}
                  label="截图"
                  loading={snapBusy}
                  onClick={doSnapshot}
                />
                <HudButton label="检测区域" onClick={() => setRoiOpen(true)} />
                <HudButton icon={<IconExpand style={{ fontSize: 14 }} />} label="全屏" onClick={fullscreen} />
              </div>
            </div>
          ) : null}
        </div>

        {/* 单行状态（任务书 §28：不做 Stat Card，一行即可） */}
        <div className="flex h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-3 text-caption text-cam-text-secondary">
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'animate-breathe bg-cam-success' : 'bg-cam-danger',
              )}
            />
            {connected ? 'Online' : 'Offline'}
          </span>
          <span className="cam-num shrink-0">{cam.fps.toFixed(1)} FPS</span>
          <span className="cam-num shrink-0">
            {cam.width}×{cam.height}
          </span>
          {recording ? (
            <span className="cam-num inline-flex shrink-0 items-center gap-1.5 text-cam-rec">
              <span className="h-1.5 w-1.5 animate-rec-pulse rounded-full bg-current" />
              Recording
            </span>
          ) : (
            <span className="shrink-0 text-cam-text-tertiary">
              {status.recorder.enabled ? 'Standby' : 'Recording Off'}
            </span>
          )}
          <Tooltip content={`录像占用（含快照按保留策略清理）`}>
            <span className="hidden shrink-0 items-center gap-2 md:inline-flex">
              <span className="h-1 w-24 overflow-hidden rounded-full bg-cam-active">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${diskPct}%`,
                    background:
                      diskPct >= 90
                        ? 'rgb(var(--cam-danger-rgb))'
                        : diskPct >= 75
                          ? 'rgb(var(--cam-warning-rgb))'
                          : 'var(--cam-meter)',
                  }}
                />
              </span>
              <span className="cam-num text-cam-text-tertiary">
                {(status.disk.recordings_bytes / 1024 ** 3).toFixed(1)} / {status.disk.max_gb} GB
              </span>
            </span>
          </Tooltip>
          {error ? <span className="shrink-0 text-cam-danger">刷新失败</span> : null}
        </div>
      </div>

      {/* ---------- 右侧最近事件：xl+ 固定栏 / <xl 视口下方区块 ---------- */}
      {eventsRail}

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
              className="block w-full rounded-md border border-cam-border bg-black"
            />
            <div className="cam-num mt-2 break-all text-caption text-cam-text-tertiary">文件：{shot.file}</div>
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
            className="block w-full rounded-md border border-cam-border bg-black"
          />
        ) : null}
      </Modal>
    </div>
  )
}
