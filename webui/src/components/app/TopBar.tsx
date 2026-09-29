/**
 * TopBar —— 48px 工作台顶栏（v1.4.4 精修）。
 * 左：Page Context（14px/medium）。右：MOCK · REC · 布防（状态 metadata，非按钮视觉）·
 *     时钟(mono) · 主题 · ⌘K · 移动端菜单。视觉优先级：Page > Status > Clock > Theme > Command。
 * 移动端（<sm）只保留 Page/Theme/Menu，REC 与布防移入导航 Drawer（功能不丢，任务书 §45）。
 * REC / 布防逻辑在 StatusActions（与 Drawer 共用）。
 */
import { IconMenu, IconSearch } from '@arco-design/web-react/icon'
import { useEffect, useState } from 'react'
import type { Status } from '../../api/types'
import { IS_MOCK } from '../../api/client'
import { formatClock } from '../../utils/format'
import { cx } from '../../utils/cx'
import { ArmAction, RecAction } from './StatusActions'
import { ThemeToggle } from './ThemeToggle'

/** 页面标题映射（与 Sidebar 导航一致） */
export const PAGE_TITLES: Record<string, string> = {
  '/': '监控',
  '/playback': '回看',
  '/dashboard': '系统概览',
  '/events': '事件',
  '/recordings': '录像',
  '/settings': '设置',
  '/logs': '日志',
}

/** 顶栏时钟（mono + tabular-nums，秒级跳动不加动画） */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="cam-num hidden text-body-secondary text-cam-text-tertiary lg:inline">{formatClock(now)}</span>
}

export function TopBar({
  pathname,
  status,
  reload,
  onOpenCommandMenu,
  onOpenMobileNav,
}: {
  pathname: string
  /** AppLayout 轮询的状态（REC / 布防展示与操作依赖） */
  status?: Status | null
  reload: () => void
  onOpenCommandMenu: () => void
  onOpenMobileNav: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-cam-border bg-cam-bg px-5 md:px-7">
      {/* 左：页面名（Page Context） */}
      <h1 className="truncate text-topbar-title text-cam-text-primary">{PAGE_TITLES[pathname] ?? 'CamBox'}</h1>

      {/* 右：Status → Clock → Theme → Command；分隔线最多 1 条（任务书 §47） */}
      <div className="flex shrink-0 items-center gap-3">
        {IS_MOCK ? (
          <span className="hidden rounded bg-cam-warning/[0.08] px-1.5 py-0.5 text-[10px] font-medium leading-[14px] text-cam-warning sm:inline-block">
            MOCK
          </span>
        ) : null}

        {/* REC / 布防：状态 metadata；移动端隐藏（进 Drawer，任务书 §45） */}
        <RecAction status={status} reload={reload} className="hidden sm:inline-flex" />
        <ArmAction status={status} reload={reload} className="hidden sm:inline-flex" />

        <span className="hidden h-4 w-px bg-cam-border sm:block" aria-hidden="true" />

        <Clock />

        <ThemeToggle />

        {/* Command Menu 入口（⌘K / Ctrl+K）：轻量 command affordance，无描边 */}
        <button
          type="button"
          aria-label="打开命令面板"
          onClick={onOpenCommandMenu}
          className={cx(
            'hidden h-7 items-center gap-1.5 rounded-md px-2 text-caption',
            'text-cam-text-tertiary transition-colors duration-150 ease-cam md:inline-flex',
            'hover:bg-cam-hover hover:text-cam-text-secondary',
          )}
        >
          <IconSearch style={{ fontSize: 12 }} />
          <span>搜索</span>
          <kbd className="cam-num rounded border border-cam-border px-1 text-[10px] leading-[14px] text-cam-text-tertiary">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          aria-label="打开导航"
          onClick={onOpenMobileNav}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-hover hover:text-cam-text-primary md:hidden"
        >
          <IconMenu style={{ fontSize: 15 }} />
        </button>
      </div>
    </header>
  )
}
