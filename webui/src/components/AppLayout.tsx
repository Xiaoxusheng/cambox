/**
 * 全局布局：Sider 菜单 + Header（相机名 / 布防状态 / 时钟）+ 内容区。
 * 移动端（≤768px）Sider 折叠为抽屉。
 */
import { useEffect, useState } from 'react'
import { Layout, Menu, Drawer, Tag, Button, Tooltip } from '@arco-design/web-react'
import {
  IconBug,
  IconDashboard,
  IconFolder,
  IconMenu,
  IconMenuFold,
  IconMenuUnfold,
  IconNotification,
  IconPlayCircle,
  IconSettings,
  IconVideoCamera,
} from '@arco-design/web-react/icon'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { IS_MOCK } from '../api/client'
import { fetchStatus } from '../api/endpoints'
import { useAsync } from '../hooks/useAsync'
import { useIsMobile } from '../hooks/useMediaQuery'
import { formatClock } from '../utils/format'

const NAV = [
  { key: '/dashboard', label: '概览', icon: <IconDashboard /> },
  { key: '/live', label: '实时', icon: <IconVideoCamera /> },
  { key: '/playback', label: '回放', icon: <IconPlayCircle /> },
  { key: '/events', label: '事件', icon: <IconNotification /> },
  { key: '/recordings', label: '录像', icon: <IconFolder /> },
  { key: '/settings', label: '设置', icon: <IconSettings /> },
  { key: '/logs', label: '日志', icon: <IconBug /> },
]

function Brand() {
  return (
    <div className="ch-logo">
      <span className="ch-logo-dot" />
      <span>camhub</span>
      <span className="ch-logo-sub">监控面板</span>
    </div>
  )
}

function NavMenu({ collapsed, onPick }: { collapsed: boolean; onPick: (key: string) => void }) {
  const { pathname } = useLocation()
  const selected = NAV.find((n) => pathname.startsWith(n.key))?.key ?? '/dashboard'
  return (
    <Menu
      selectedKeys={[selected]}
      onClickMenuItem={onPick}
      collapse={collapsed}
      style={{ flex: 1, borderRight: 'none' }}
    >
      {NAV.map((n) => (
        <Menu.Item key={n.key}>
          {n.icon}
          {n.label}
        </Menu.Item>
      ))}
    </Menu>
  )
}

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
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Header 元信息：相机名 / 在线状态 / fps；5s 静默轮询
  const { data: status } = useAsync((signal) => fetchStatus(signal), [], { pollMs: 5000 })

  useEffect(() => {
    if (isMobile) setDrawerOpen(false)
  }, [isMobile, pathname])

  const onPick = (key: string) => {
    navigate(key)
    setDrawerOpen(false)
  }

  const cam = status?.camera
  const connected = cam?.connected ?? false

  return (
    <Layout className="ch-layout">
      {!isMobile ? (
        <Layout.Sider
          className="ch-sider"
          collapsed={collapsed}
          collapsedWidth={56}
          width={200}
          trigger={null}
        >
          <Brand />
          <NavMenu collapsed={collapsed} onPick={onPick} />
        </Layout.Sider>
      ) : (
        <Drawer
          visible={drawerOpen}
          placement="left"
          width={232}
          footer={null}
          closable={false}
          onCancel={() => setDrawerOpen(false)}
          bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
        >
          <Brand />
          <NavMenu collapsed={false} onPick={onPick} />
        </Drawer>
      )}

      <Layout>
        <Layout.Header className="ch-header">
          {isMobile ? (
            <Button
              type="text"
              icon={<IconMenu />}
              aria-label="打开导航菜单"
              onClick={() => setDrawerOpen(true)}
            />
          ) : (
            <Tooltip content={collapsed ? '展开导航' : '收起导航'}>
              <Button
                type="text"
                aria-label={collapsed ? '展开导航' : '收起导航'}
                icon={collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
                onClick={() => setCollapsed((v) => !v)}
              />
            </Tooltip>
          )}

          <span className="ch-header-title">
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

          {status ? (
            <Tag color={status.armed ? 'green' : 'gray'} size="small">
              {status.armed ? '布防中' : '已撤防'}
            </Tag>
          ) : null}

          {IS_MOCK ? (
            <Tooltip content="当前为 mock 数据模式，未连接后端">
              <Tag color="orange" size="small">
                MOCK
              </Tag>
            </Tooltip>
          ) : null}

          <Clock />
        </Layout.Header>

        <Layout.Content className="ch-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
