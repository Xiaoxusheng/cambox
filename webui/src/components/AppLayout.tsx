/**
 * 全局布局（v1.2 监控优先外壳，契约 §4.1）：移除 Sider，改顶部单行细栏。
 * 顶部栏：相机名 · 连接状态点 · fps · 分辨率 · 布防开关 · 时钟 · 导航（监控 / 回看 / 更多▾）。
 * 二级页面（概览/事件/录像/设置/日志）收进「更多▾」；移动端导航整体收进抽屉。
 */
import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  Dropdown,
  Layout,
  Menu,
  Message,
  Switch,
  Tag,
  Tooltip,
} from '@arco-design/web-react'
import { IconDown, IconMenu } from '@arco-design/web-react/icon'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { IS_MOCK } from '../api/client'
import { fetchStatus, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import { useAsync } from '../hooks/useAsync'
import { useIsMobile } from '../hooks/useMediaQuery'
import { formatClock } from '../utils/format'

/** 二级页面：桌面收进「更多▾」，移动端收进抽屉 */
const MORE_NAV = [
  { key: '/dashboard', label: '概览' },
  { key: '/events', label: '事件中心' },
  { key: '/recordings', label: '录像管理' },
  { key: '/settings', label: '设置' },
  { key: '/logs', label: '日志' },
]

const MOBILE_NAV = [{ key: '/', label: '监控' }, { key: '/playback', label: '回看' }, ...MORE_NAV]

/** 「监控」要求精确匹配，其余前缀匹配（避免 startsWith('/') 恒真） */
const isActive = (pathname: string, key: string) =>
  key === '/' ? pathname === '/' : pathname.startsWith(key)

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="num ch-hide-mobile">{formatClock(now)}</span>
}

export function AppLayout() {
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [armPending, setArmPending] = useState(false)
  const navigate = useNavigate()
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
  const moreActive = MORE_NAV.find((n) => isActive(pathname, n.key))

  return (
    <Layout className="ch-layout">
      <Layout.Header className="ch-header">
        {isMobile ? (
          <Button
            type="text"
            icon={<IconMenu />}
            aria-label="打开导航"
            onClick={() => setDrawerOpen(true)}
          />
        ) : (
          <span className="ch-brand" aria-hidden="true">
            <span className="ch-brand-dot" />
            camhub
          </span>
        )}

        <span className="ch-header-title" title={cam?.name}>
          <span className={`ch-status-dot ${connected ? 'ok' : 'err'}`} />
          {cam?.name || '摄像头'}
        </span>

        <span className="ch-header-meta ch-hide-mobile">
          {connected ? (
            <>
              <span className="num">{cam?.fps.toFixed(1)} fps</span>
              <span className="num">
                {cam?.width}×{cam?.height}
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--ch-danger)' }}>未连接</span>
          )}
        </span>

        <span className="ch-header-spacer" />

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
            <span
              className="ch-hide-mobile"
              style={{ fontSize: 12, color: armed ? 'var(--ch-ok)' : 'var(--color-text-3)' }}
            >
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

        {!isMobile ? (
          <nav className="ch-nav" aria-label="主导航">
            <button
              type="button"
              className={`ch-nav-link ${isActive(pathname, '/') ? 'active' : ''}`}
              onClick={() => go('/')}
            >
              监控
            </button>
            <button
              type="button"
              className={`ch-nav-link ${isActive(pathname, '/playback') ? 'active' : ''}`}
              onClick={() => go('/playback')}
            >
              回看
            </button>
            <Dropdown
              trigger="click"
              position="br"
              droplist={
                <Menu selectedKeys={moreActive ? [moreActive.key] : []} onClickMenuItem={go}>
                  {MORE_NAV.map((n) => (
                    <Menu.Item key={n.key}>{n.label}</Menu.Item>
                  ))}
                </Menu>
              }
            >
              <button
                type="button"
                className={`ch-nav-link ${moreActive ? 'active' : ''}`}
                aria-haspopup="menu"
              >
                {moreActive ? moreActive.label : '更多'}
                <IconDown />
              </button>
            </Dropdown>
          </nav>
        ) : null}
      </Layout.Header>

      <Layout.Content className="ch-content">
        <Outlet />
      </Layout.Content>

      <Drawer
        visible={drawerOpen}
        placement="left"
        width={240}
        footer={null}
        title="导航"
        closable
        onCancel={() => setDrawerOpen(false)}
        bodyStyle={{ padding: 'var(--ch-space-sm)' }}
      >
        {MOBILE_NAV.map((n) => (
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
    </Layout>
  )
}
