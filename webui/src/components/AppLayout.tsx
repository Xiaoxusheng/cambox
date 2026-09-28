/**
 * 全局布局（v1.3，按 camhub-ui-4k 设计稿重做）：悬浮玻璃顶栏。
 * 左：品牌 | 相机名 · 在线 · FPS · 分辨率；右：REC · 布防开关 · 时钟 | 导航 pill×7。
 * 换页走 View Transitions API（旧页 180ms 淡出，新页逐层 +60ms 错峰入场）；
 * 不支持或 prefers-reduced-motion 时直切。移动端导航收进抽屉。
 */
import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { Drawer, Message, Switch, Tag, Tooltip } from '@arco-design/web-react'
import { IconMenu } from '@arco-design/web-react/icon'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { IS_MOCK } from '../api/client'
import { fetchStatus, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import { useAsync } from '../hooks/useAsync'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { formatClock } from '../utils/format'

/** 设计稿为 7 个导航 pill 平铺（不再收「更多▾」） */
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

/** 换页：优先 View Transitions（旧页淡出 180ms），reduced-motion 或不支持时直切 */
function useVtNavigate() {
  const navigate = useNavigate()
  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  return (to: string) => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown
    }
    if (!reduceMotion && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        flushSync(() => navigate(to))
      })
    } else {
      navigate(to)
    }
  }
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="ch-clock ch-hide-mobile">{formatClock(now)}</span>
}

export function AppLayout() {
  const isMobile = useMediaQuery('(max-width: 900px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [armPending, setArmPending] = useState(false)
  const navigate = useVtNavigate()
  const { pathname } = useLocation()

  // 顶部栏元信息：相机名 / 在线状态 / fps；5s 静默轮询
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

  const cam = status?.camera
  const connected = cam?.connected ?? false
  const armed = status?.armed ?? false
  const recording = status?.recorder.running ?? false

  return (
    <div className="ch-shell">
      {/* 固定背景层：网格 + 光晕。独立于 body，规避 backdrop-filter 采样异常 */}
      <div className="ch-bg" aria-hidden="true" />
      <header className="ch-topbar">
        {isMobile ? (
          <button
            type="button"
            className="ch-btn icon"
            aria-label="打开导航"
            onClick={() => setDrawerOpen(true)}
          >
            <IconMenu />
          </button>
        ) : (
          <span className="ch-brand" aria-hidden="true">
            <span className="ch-brand-dot" />
            camhub
          </span>
        )}

        <span className="ch-topbar-divider ch-hide-mobile" />

        <span className="ch-topbar-cam" title={cam?.name}>
          <span className={`ch-status-dot ${connected ? 'ok' : 'err'}`} />
          <span className="ch-hide-mobile" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cam?.name || '摄像头'}
          </span>
          <span className={`ch-badge ${connected ? 'ok' : 'danger'}`}>
            {connected ? '在线' : '离线'}
          </span>
        </span>

        <span className="ch-topbar-meta ch-hide-mobile">
          {connected ? (
            <>
              <span className="num ch-topbar-fps">{cam?.fps.toFixed(1)} FPS</span>
              <span className="num ch-topbar-res">
                {cam?.width}×{cam?.height}
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--ch-danger)' }}>等待取流</span>
          )}
        </span>

        <span className="ch-topbar-spacer" />

        <Tooltip
          content={
            recording ? '录像进行中（按分段写入）' : status ? '录像未在运行' : '获取状态中…'
          }
        >
          <span className={`ch-rec ${recording ? '' : 'off'}`} aria-label={recording ? '录像中' : '未录像'}>
            <span className="ch-rec-dot" />
            REC
          </span>
        </Tooltip>

        <Tooltip
          content={armed ? '布防中：移动侦测事件将入库并推送' : '已撤防：仅停止事件入库与推送'}
        >
          <span className="ch-arm">
            <Switch
              size="small"
              checked={armed}
              loading={armPending}
              disabled={!status}
              onChange={toggleArm}
              aria-label="布防开关"
            />
            <span className={`ch-arm-label ch-hide-mobile ${armed ? '' : 'off'}`}>
              {armed ? '布防中' : '已撤防'}
            </span>
          </span>
        </Tooltip>

        {IS_MOCK ? (
          <Tooltip content="当前为 mock 数据模式，未连接后端">
            <Tag color="orange" size="small">
              MOCK
            </Tag>
          </Tooltip>
        ) : null}

        <Clock />

        <span className="ch-topbar-divider ch-hide-mobile" />

        {!isMobile ? (
          <nav className="ch-nav" aria-label="主导航">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                className={`ch-navpill ${isActive(pathname, n.key) ? 'active' : ''}`}
                aria-current={isActive(pathname, n.key) ? 'page' : undefined}
                onClick={() => go(n.key)}
              >
                {n.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="ch-content">
        <div key={pathname} className="ch-page">
          <Outlet />
        </div>
      </main>

      <Drawer
        visible={drawerOpen}
        placement="left"
        width={248}
        footer={null}
        title="导航"
        closable
        onCancel={() => setDrawerOpen(false)}
        bodyStyle={{ padding: 'var(--ch-space-sm)' }}
      >
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            className={`ch-drawer-link ${isActive(pathname, n.key) ? 'active' : ''}`}
            onClick={() => go(n.key)}
          >
            {n.label}
          </button>
        ))}
      </Drawer>
    </div>
  )
}
