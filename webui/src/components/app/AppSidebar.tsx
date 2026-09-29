/**
 * AppSidebar —— Workspace 左导航（v1.4 Linear-style）。
 * 结构：品牌行 → CAMERAS（相机 + 在线点 + 分辨率）→ WORKSPACE（监控/回看/事件/录像）→
 *       SYSTEM（系统概览/设置/日志）→ 底部版本。
 * 交互状态：默认 text-secondary 透明底；hover cam-hover；active cam-selected + 主文字
 * （token 主题感知：dark 白透明度 / light 黑透明度，任务书 Light §5）。
 * 主题切换统一收敛到 TopBar 的 ThemeToggle（Light §33 单一入口）。相机数据由 AppLayout 轮询后传入。
 */
import { type ReactNode } from 'react'
import {
  IconCamera,
  IconCode,
  IconDashboard,
  IconNotification,
  IconPlayCircle,
  IconSettings,
  IconStorage,
  IconVideoCamera,
} from '@arco-design/web-react/icon'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { CameraStatus } from '../../api/types'
import { cx } from '../../utils/cx'
import pkg from '../../../package.json'

export const NAV_WORKSPACE = [
  { key: '/', label: '监控', icon: <IconVideoCamera /> },
  { key: '/playback', label: '回看', icon: <IconPlayCircle /> },
  { key: '/events', label: '事件', icon: <IconNotification /> },
  { key: '/recordings', label: '录像', icon: <IconStorage /> },
]

export const NAV_SYSTEM = [
  { key: '/dashboard', label: '系统概览', icon: <IconDashboard /> },
  { key: '/settings', label: '设置', icon: <IconSettings /> },
  { key: '/logs', label: '日志', icon: <IconCode /> },
]

/** 「监控」要求精确匹配，其余前缀匹配（避免 startsWith('/') 恒真） */
export const isActivePath = (pathname: string, key: string) =>
  key === '/' ? pathname === '/' : pathname.startsWith(key)

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-cam-text-tertiary">
      {children}
    </div>
  )
}

export function NavItem({
  item,
  active,
  onNavigate,
}: {
  item: { key: string; label: string; icon: ReactNode }
  active: boolean
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        navigate(item.key)
        onNavigate?.()
      }}
      className={cx(
        'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-body',
        'transition-colors duration-100 ease-cam',
        active
          ? 'bg-cam-selected font-medium text-cam-text-primary'
          : 'text-cam-text-secondary hover:bg-cam-hover hover:text-cam-text-primary',
      )}
    >
      <span
        className={cx(
          'shrink-0 [&_svg]:!h-[14px] [&_svg]:!w-[14px]',
          active ? 'text-cam-text-primary' : 'text-cam-text-tertiary',
        )}
      >
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
    </button>
  )
}

/** Sidebar 全部内容（AppSidebar 与移动端 Drawer 复用） */
export function SidebarContent({
  camera,
  onNavigate,
}: {
  /** 相机状态（AppLayout 5s 轮询） */
  camera?: CameraStatus
  onNavigate?: () => void
}) {
  const { pathname } = useLocation()
  const connected = camera?.connected ?? false

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3">
      {/* CAMERAS */}
      <SectionLabel>Cameras</SectionLabel>
      <Link
        to="/"
        onClick={onNavigate}
        aria-label={`${camera?.name ?? '摄像头'} · ${connected ? '在线' : '离线'}`}
        className="group flex w-full items-start gap-2 rounded-md px-2 py-2 no-underline transition-colors duration-100 ease-cam hover:bg-cam-hover hover:no-underline"
      >
        <span
          className={cx(
            'mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full',
            connected ? 'animate-breathe bg-cam-success' : 'bg-cam-danger',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-cam-text-primary">
            {camera?.name ?? '摄像头'}
          </span>
          {/* 状态只由小圆点表达（不使用彩色大字），metadata 保持 mono 灰 */}
          <span className="cam-num mt-0.5 block truncate text-caption text-cam-text-tertiary">
            {camera ? `${camera.width}×${camera.height}` : '连接中…'}
          </span>
        </span>
      </Link>

      {/* WORKSPACE */}
      <SectionLabel>Workspace</SectionLabel>
      <nav className="flex flex-col gap-0.5" aria-label="工作区导航">
        {NAV_WORKSPACE.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={isActivePath(pathname, item.key)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {/* SYSTEM */}
      <SectionLabel>System</SectionLabel>
      <nav className="flex flex-col gap-0.5" aria-label="系统导航">
        {NAV_SYSTEM.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={isActivePath(pathname, item.key)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </div>
  )
}

/** 桌面端固定 Sidebar（移动端隐藏，由 BottomNav + Drawer 接管） */
export function AppSidebar({ camera }: { camera?: CameraStatus }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-cam-border bg-cam-sidebar md:flex">
      {/* 品牌行：轻图标，不做 Logo 方块（任务书 §60） */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <IconCamera style={{ fontSize: 16 }} className="shrink-0 text-cam-text-secondary" />
        <span className="text-[14px] font-semibold tracking-tight text-cam-text-primary">CamBox</span>
      </div>

      <SidebarContent camera={camera} />

      {/* 底部：品牌 + 版本（10px metadata；主题切换统一在 TopBar，任务书 Light §33 单一入口） */}
      <div className="shrink-0 border-t border-cam-border px-4 pb-3 pt-2.5">
        <div className="text-caption font-medium text-cam-text-secondary">CamBox</div>
        <div className="cam-num mt-0.5 text-[10px] leading-4 text-cam-text-4">v{pkg.version}</div>
      </div>
    </aside>
  )
}
