/**
 * AppLayout —— CamBox Workspace 外壳（v1.4 Linear-style 重构）。
 *
 * 结构（任务书 §7）：
 *   ┌───────────┬──────────────────────────────┐
 *   │ Sidebar   │ TopBar（页面名 · 状态 · ⌘K） │
 *   │ 224px     ├──────────────────────────────┤
 *   │           │ Main（内部滚动）             │
 *   │           ├──────────────────────────────┤
 *   │           │ BottomNav（仅 <768px）       │
 *   └───────────┴──────────────────────────────┘
 * 桌面 = 固定 Sidebar；移动端 = BottomNav + Drawer（真正重排，不缩小桌面布局）。
 * 监控页全出血（h-full），其余页带 padding 与最大宽度。⌘K / Ctrl+K 打开 CommandMenu。
 */
import { useEffect, useState } from 'react'
import { Drawer } from '@arco-design/web-react'
import { IconApps, IconNotification, IconPlayCircle, IconVideoCamera } from '@arco-design/web-react/icon'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { fetchStatus } from '../api/endpoints'
import { useAsync } from '../hooks/useAsync'
import { watchSystemTheme } from '../theme'
import { cx } from '../utils/cx'
import { AppSidebar, SidebarContent, isActivePath } from './app/AppSidebar'
import { CommandMenu } from './app/CommandMenu'
import { ArmAction, RecAction } from './app/StatusActions'
import { TopBar } from './app/TopBar'

/** 移动端底部导航（任务书 §63：监控 / 回看 / 事件 / 更多） */
function BottomNav({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const navigate = useNavigate()
  const items = [
    { key: '/', label: '监控', icon: <IconVideoCamera style={{ fontSize: 17 }} /> },
    { key: '/playback', label: '回看', icon: <IconPlayCircle style={{ fontSize: 17 }} /> },
    { key: '/events', label: '事件', icon: <IconNotification style={{ fontSize: 17 }} /> },
  ]
  return (
    <nav
      className="flex h-14 shrink-0 items-stretch border-t border-cam-border bg-cam-bg md:hidden"
      aria-label="底部导航"
    >
      {items.map((it) => {
        const active = isActivePath(pathname, it.key)
        return (
          <button
            key={it.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(it.key)}
            className={cx(
              'flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-100 ease-cam',
              active ? 'text-cam-text-primary' : 'text-cam-text-tertiary hover:text-cam-text-secondary',
            )}
          >
            {it.icon}
            <span className="text-caption">{it.label}</span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={onMore}
        aria-label="更多导航"
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-cam-text-tertiary transition-colors duration-100 ease-cam hover:text-cam-text-secondary"
      >
        <IconApps style={{ fontSize: 17 }} />
        <span className="text-caption">更多</span>
      </button>
    </nav>
  )
}

export function AppLayout() {
  const { pathname } = useLocation()
  const [cmdOpen, setCmdOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // 顶栏/侧栏共用的相机状态：5s 静默轮询（不打断滚动/hover/选中）
  const { data: status, reload } = useAsync((signal) => fetchStatus(signal), [], { pollMs: 5000 })

  // system 主题：跟随 prefers-color-scheme 动态切换（不刷新页面）
  useEffect(() => watchSystemTheme(), [])

  // ⌘K / Ctrl+K 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-dvh overflow-hidden bg-cam-bg">
      <AppSidebar camera={status?.camera} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          pathname={pathname}
          status={status}
          reload={reload}
          onOpenCommandMenu={() => setCmdOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        {/* 内容：监控页全出血，其余页居中限宽 1500（大屏不无限拉伸）；页面切换极轻入场 */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div
            key={pathname}
            className={cx(
              'h-full animate-page-in',
              pathname === '/'
                ? ''
                : 'mx-auto w-full max-w-[1500px] px-5 py-5 md:px-7 md:py-6 xl:px-10 2xl:px-12',
            )}
          >
            <Outlet />
          </div>
        </main>

        <BottomNav pathname={pathname} onMore={() => setMobileNavOpen(true)} />
      </div>

      {/* 移动端导航 Drawer：完整 Sidebar 内容（CAMERAS / WORKSPACE / SYSTEM）；主题在 TopBar */}
      <Drawer
        visible={mobileNavOpen}
        placement="left"
        width={272}
        footer={null}
        title="CamBox"
        closable
        onCancel={() => setMobileNavOpen(false)}
        headerStyle={{ borderBottom: '1px solid var(--cam-border)' }}
        bodyStyle={{ padding: '8px 0 12px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SidebarContent camera={status?.camera} onNavigate={() => setMobileNavOpen(false)} />
        </div>
        {/* 状态操作区：移动端 TopBar 不显示 REC/布防，收进 Drawer（功能不丢，任务书 §45） */}
        <div className="mt-3 flex shrink-0 items-center gap-3 border-t border-cam-border px-1 pt-3">
          <RecAction status={status} reload={reload} />
          <ArmAction status={status} reload={reload} />
          <span className="cam-num ml-auto text-caption text-cam-text-tertiary">CamBox</span>
        </div>
      </Drawer>

      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  )
}
