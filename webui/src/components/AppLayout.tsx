/**
 * AppLayout —— camhub 胶囊顶栏（v1.3 重设计，Tailwind 主样式层）。
 *
 * 结构（依据设计稿 01-监控 顶栏 + 任务书 §8~10）：
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ ● camhub  ● 前门摄像头·在线 24.0FPS 2560×1440 │ ●REC ▣布防 17:53:46 │ 监控 回看 …  ☰ │
 *   └──────────────────────────────────────────────────────────────────────┘
 * 左：品牌 + 相机状态（呼吸点 = 活着的状态才有动画）；右：REC / 布防 / 时钟 / 导航 / 主题 / MOCK / 移动端 Drawer。
 * 交互能力仍走 Arco（Switch/Drawer/Modal/Message/Tooltip）；视觉全部 Tailwind cam.* token。
 * 监控页全出血，其余页居中 max-w-[1440px]。
 */
import { useEffect, useState } from 'react'
import { Drawer, Message, Modal, Switch, Tooltip } from '@arco-design/web-react'
import {
  IconMenu,
  IconMoon,
  IconRecord,
  IconRecordStop,
  IconSun,
} from '@arco-design/web-react/icon'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { IS_MOCK } from '../api/client'
import { fetchConfig, fetchStatus, saveConfig, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import { useAsync } from '../hooks/useAsync'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { getTheme, setTheme, type Theme } from '../theme'
import { formatClock } from '../utils/format'
import { cx } from '../utils/cx'
import { StatusBadge } from './common/StatusBadge'

const NAV = [
  { key: '/', label: '监控' },
  { key: '/playback', label: '回看' },
  { key: '/dashboard', label: '概览' },
  { key: '/events', label: '事件' },
  { key: '/recordings', label: '录像' },
  { key: '/settings', label: '设置' },
  { key: '/logs', label: '日志' },
]

/** 「监控」要求精确匹配，其余前缀匹配（避免 startsWith('/') 恒真） */
const isActive = (pathname: string, key: string) =>
  key === '/' ? pathname === '/' : pathname.startsWith(key)

/** 顶栏时钟（mono + tabular-nums，秒级跳动不加动画） */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <span className="cam-num hidden text-caption text-cam-text-secondary xl:inline">
      {formatClock(now)}
    </span>
  )
}

export function AppLayout() {
  const isMobile = useMediaQuery('(max-width: 900px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [armPending, setArmPending] = useState(false)
  const [recPending, setRecPending] = useState(false)
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // 顶栏元信息：相机名 / 在线状态 / fps；5s 静默轮询（不打断滚动/hover/选中）
  const { data: status, reload } = useAsync((signal) => fetchStatus(signal), [], { pollMs: 5000 })

  useEffect(() => {
    if (isMobile) setDrawerOpen(false)
  }, [isMobile, pathname])

  const go = (key: string) => {
    navigate(key)
    setDrawerOpen(false)
  }

  const toggleArm = async (next: boolean) => {
    setArmPending(true)
    try {
      await setArmed(next)
      Message.success(next ? '已布防，移动侦测事件将入库并推送' : '已撤防，仅停止事件入库与推送')
      reload()
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setArmPending(false)
    }
  }

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setThemeState(next)
    setTheme(next)
  }

  /** 顶栏 REC 开关：切换 record.enabled（热更新生效）。点击时现取配置再全量保存，避免覆盖较新的改动 */
  const toggleRecord = () => {
    const next = !recording
    Modal.confirm({
      title: next ? '开始录像？' : '结束录像？',
      content: next
        ? '将启用自动录像并写入 configs/config.yaml（热更新生效）；是否启动仍受布防日程约束。'
        : '将停止自动录像并写入 configs/config.yaml（热更新生效）；布防与侦测不受影响，可随时再次开启。',
      okText: next ? '开始录像' : '结束录像',
      cancelText: '取消',
      okButtonProps: next ? undefined : { status: 'danger' },
      onOk: async () => {
        setRecPending(true)
        try {
          const cfg = await fetchConfig()
          await saveConfig({ ...cfg, record: { ...cfg.record, enabled: next } })
          Message.success(next ? '已开始录像' : '已结束录像，当前分段会正常收尾')
          reload()
        } catch (e) {
          Message.error(errorText(e))
        } finally {
          setRecPending(false)
        }
      },
    })
  }

  const cam = status?.camera
  const connected = cam?.connected ?? false
  const armed = status?.armed ?? false
  const recording = status?.recorder.running ?? false

  return (
    <div className="flex min-h-screen flex-col bg-cam-bg">
      {/* ---------- 胶囊顶栏：sticky + 实体底（内容从其下滚过，无缝隙穿帮） ---------- */}
      <header className="sticky top-0 z-100 border-b border-cam-border bg-cam-bg/95 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center justify-between gap-3 px-3 md:px-4">
          {/* 左：品牌 + 相机状态 */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2"
              aria-label="camhub 监控面板"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cam-accent-dim text-cam-accent">
                <IconRecord style={{ fontSize: 15 }} />
              </span>
              <span className="hidden text-[15px] font-semibold tracking-tight text-cam-text-primary sm:inline">
                camhub
              </span>
            </Link>
            <span className="h-4 w-px bg-cam-border-strong" aria-hidden="true" />
            {cam ? (
              <span className="flex min-w-0 items-center gap-2" title={cam.name}>
                <StatusBadge
                  tone={connected ? 'success' : 'danger'}
                  label={connected ? '在线' : '离线'}
                  breathe={connected}
                />
                <span className="hidden max-w-[180px] truncate text-caption text-cam-text-secondary md:inline">
                  {cam.name}
                </span>
                {connected ? (
                  <span className="cam-num hidden text-caption text-cam-text-tertiary lg:inline">
                    {cam.fps.toFixed(1)} FPS · {cam.width}×{cam.height}
                  </span>
                ) : (
                  <span className="hidden text-caption text-cam-danger md:inline">等待取流</span>
                )}
              </span>
            ) : (
              <StatusBadge tone="neutral" label="连接中" breathe />
            )}
          </div>

          {/* 右：REC / 布防 / 时钟 / MOCK / 主题 / 导航 / 移动菜单 */}
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip
              content={
                recording
                  ? '录像进行中，点击结束录像（写入配置，热更新生效）'
                  : status
                    ? '点击开始录像（写入配置，热更新生效）'
                    : '获取状态中…'
              }
            >
              <button
                type="button"
                aria-label={recording ? '结束录像' : '开始录像'}
                disabled={!status || recPending}
                onClick={toggleRecord}
                className={cx(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-caption font-medium',
                  'transition-colors duration-150 ease-cam disabled:pointer-events-none disabled:opacity-40',
                  recording
                    ? 'border border-cam-rec/40 bg-cam-rec/12 text-cam-rec'
                    : 'border border-cam-border text-cam-text-secondary hover:border-cam-border-strong hover:text-cam-text-primary',
                )}
              >
                {recording ? (
                  <IconRecordStop style={{ fontSize: 14 }} />
                ) : (
                  <IconRecord style={{ fontSize: 14 }} />
                )}
                <span className={cx(recording && 'animate-rec-pulse')}>REC</span>
              </button>
            </Tooltip>

            <Tooltip content={armed ? '布防中：移动侦测事件将入库并推送' : '已撤防：仅停止事件入库与推送'}>
              <span className="flex items-center gap-1.5">
                <Switch
                  size="small"
                  checked={armed}
                  loading={armPending}
                  disabled={!status}
                  onChange={toggleArm}
                  aria-label="布防开关"
                />
                <span className="hidden text-caption text-cam-text-secondary md:inline">
                  {armed ? '布防中' : '已撤防'}
                </span>
              </span>
            </Tooltip>

            {IS_MOCK ? (
              <Tooltip content="当前为 mock 数据模式，未连接后端">
                <span className="hidden h-6 items-center rounded-md border border-cam-warning/40 bg-cam-warning/10 px-2 text-caption font-medium text-cam-warning sm:inline-flex">
                  MOCK
                </span>
              </Tooltip>
            ) : null}

            <Clock />

            <Tooltip content={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}>
              <button
                type="button"
                aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
                onClick={toggleTheme}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-active hover:text-cam-text-primary"
              >
                {theme === 'dark' ? <IconSun style={{ fontSize: 15 }} /> : <IconMoon style={{ fontSize: 15 }} />}
              </button>
            </Tooltip>

            {/* 桌面导航：胶囊组（非 Arco Menu），active = accent-dim 底 + accent 字 */}
            {!isMobile ? (
              <nav className="hidden items-center gap-1 rounded-xl bg-cam-elevated p-1 lg:flex" aria-label="主导航">
                {NAV.map((n) => {
                  const active = isActive(pathname, n.key)
                  return (
                    <button
                      key={n.key}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => go(n.key)}
                      className={cx(
                        'h-7 rounded-lg px-3 text-caption font-medium transition-colors duration-150 ease-cam',
                        active
                          ? 'bg-cam-accent-dim text-cam-accent'
                          : 'text-cam-text-secondary hover:bg-cam-active hover:text-cam-text-primary',
                      )}
                    >
                      {n.label}
                    </button>
                  )
                })}
              </nav>
            ) : null}

            {isMobile ? (
              <button
                type="button"
                aria-label="打开导航"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-active hover:text-cam-text-primary lg:hidden"
              >
                <IconMenu style={{ fontSize: 16 }} />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* 内容：监控页全出血，其余页居中；页面切换极轻入场（opacity + 4px） */}
      <main
        className={cx(
          'min-h-0 flex-1',
          pathname === '/' ? '' : 'mx-auto w-full max-w-[1440px] px-3 py-4 md:px-6',
        )}
      >
        <div key={pathname} className="animate-page-in">
          <Outlet />
        </div>
      </main>

      {/* 移动端导航 Drawer（Arco 交互能力，内容为胶囊按钮组） */}
      <Drawer
        visible={drawerOpen}
        placement="left"
        width={248}
        footer={null}
        title="导航"
        closable
        onCancel={() => setDrawerOpen(false)}
      >
        <nav className="flex flex-col gap-1" aria-label="移动端导航">
          {NAV.map((n) => {
            const active = isActive(pathname, n.key)
            return (
              <button
                key={n.key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => go(n.key)}
                className={cx(
                  'h-9 rounded-lg px-3 text-left text-body font-medium transition-colors duration-150 ease-cam',
                  active
                    ? 'bg-cam-accent-dim text-cam-accent'
                    : 'text-cam-text-secondary hover:bg-cam-active hover:text-cam-text-primary',
                )}
              >
                {n.label}
              </button>
            )
          })}
        </nav>
      </Drawer>
    </div>
  )
}
