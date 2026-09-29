/**
 * TopBar —— 48px 工作台顶栏（v1.4 Linear-style）。
 * 左：当前页面名（14px/medium，任务书 §14 禁止巨大标题）。
 * 右：MOCK 徽标 · REC 开关 · 布防开关 · 时钟(mono) · 主题 · ⌘K · 移动端菜单。
 * REC / 布防为原 AppLayout 逻辑平移（确认弹窗、防抖、错误提示全部保留）。
 * 主题入口唯一（Light §33）：ThemeToggle（浅色/深色/跟随系统）。
 */
import { useEffect, useState } from 'react'
import { Message, Modal, Switch, Tooltip } from '@arco-design/web-react'
import { IconMenu, IconRecord, IconRecordStop, IconSearch } from '@arco-design/web-react/icon'
import type { Status } from '../../api/types'
import { fetchConfig, saveConfig, setArmed } from '../../api/endpoints'
import { errorText } from '../../api/errors'
import { IS_MOCK } from '../../api/client'
import { formatClock } from '../../utils/format'
import { cx } from '../../utils/cx'
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
  const [armPending, setArmPending] = useState(false)
  const [recPending, setRecPending] = useState(false)

  const armed = status?.armed ?? false
  const recording = status?.recorder.running ?? false

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

  /** REC 开关：切换 record.enabled（热更新生效）。点击时现取配置再全量保存，避免覆盖较新的改动 */
  const toggleRecord = async (next: boolean) => {
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

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-cam-border bg-cam-bg px-4 md:px-5">
      {/* 左：页面名 */}
      <h1 className="truncate text-topbar-title text-cam-text-primary">{PAGE_TITLES[pathname] ?? 'CamBox'}</h1>

      {/* 右：状态与快捷操作 */}
      <div className="flex shrink-0 items-center gap-2">
        {IS_MOCK ? (
          <Tooltip content="当前为 mock 数据模式，未连接后端">
            <span className="hidden h-6 items-center rounded-md border border-cam-warning/40 bg-cam-warning/10 px-2 text-caption font-medium text-cam-warning sm:inline-flex">
              MOCK
            </span>
          </Tooltip>
        ) : null}

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
            onClick={() => toggleRecord(!recording)}
            className={cx(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-caption font-medium',
              'transition-colors duration-150 ease-cam disabled:pointer-events-none disabled:opacity-40',
              recording
                ? 'border border-cam-rec/40 bg-cam-rec/10 text-cam-rec'
                : 'border border-cam-border text-cam-text-secondary hover:border-cam-border-strong hover:text-cam-text-primary',
            )}
          >
            {recording ? <IconRecordStop style={{ fontSize: 13 }} /> : <IconRecord style={{ fontSize: 13 }} />}
            <span className={cx(recording && 'animate-rec-pulse')}>REC</span>
          </button>
        </Tooltip>

        <Tooltip content={armed ? '布防中：移动侦测事件将入库并推送' : '已撤防：仅停止事件入库与推送'}>
          <span className="hidden items-center gap-1.5 sm:flex">
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

        <Clock />

        <ThemeToggle />

        {/* Command Menu 入口（⌘K / Ctrl+K） */}
        <button
          type="button"
          aria-label="打开命令面板"
          onClick={onOpenCommandMenu}
          className={cx(
            'hidden h-7 items-center gap-1.5 rounded-md border border-cam-border px-2 text-caption',
            'text-cam-text-tertiary transition-colors duration-150 ease-cam md:inline-flex',
            'hover:border-cam-border-strong hover:text-cam-text-secondary',
          )}
        >
          <IconSearch style={{ fontSize: 12 }} />
          <span>搜索</span>
          <kbd className="cam-num ml-1 rounded border border-cam-border bg-cam-elevated px-1 text-[10px] leading-[14px] text-cam-text-tertiary">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          aria-label="打开导航"
          onClick={onOpenMobileNav}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-active hover:text-cam-text-primary md:hidden"
        >
          <IconMenu style={{ fontSize: 15 }} />
        </button>
      </div>
    </header>
  )
}
