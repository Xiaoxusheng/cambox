/**
 * ThemeToggle —— 全产品唯一主题入口（v1.4 Light Mode，任务书 §32~34）。
 * TopBar 内图标按钮（当前模式图标：Sun/Moon/Desktop）→ 下拉菜单：
 *   浅色 / 深色 / 跟随系统，当前项打勾。点击外部 / Escape 关闭。
 * system 模式由 theme.ts 的 watchSystemTheme 跟随 prefers-color-scheme 动态切换。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconCheck, IconDesktop, IconMoon, IconSun } from '@arco-design/web-react/icon'
import {
  getThemeMode,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from '../../theme'
import { cx } from '../../utils/cx'

const OPTIONS: { mode: ThemeMode; label: string; icon: JSX.Element }[] = [
  { mode: 'light', label: '浅色', icon: <IconSun /> },
  { mode: 'dark', label: '深色', icon: <IconMoon /> },
  { mode: 'system', label: '跟随系统', icon: <IconDesktop /> },
]

const MODE_LABEL: Record<ThemeMode, string> = {
  light: '浅色模式',
  dark: '深色模式',
  system: '主题：跟随系统',
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentIcon =
    mode === 'light' ? <IconSun style={{ fontSize: 15 }} /> : mode === 'dark' ? <IconMoon style={{ fontSize: 15 }} /> : <IconDesktop style={{ fontSize: 15 }} />

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={MODE_LABEL[mode]}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex h-8 w-8 items-center justify-center rounded-md',
          'text-cam-text-secondary transition-colors duration-100 ease-cam',
          'hover:bg-cam-hover hover:text-cam-text-primary',
          open && 'bg-cam-selected text-cam-text-primary',
        )}
      >
        {currentIcon}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="外观"
          className="absolute right-0 top-full z-50 mt-1.5 w-36 animate-menu-in rounded-lg border border-cam-border-strong bg-cam-elevated p-1 shadow-popover"
        >
          {OPTIONS.map((o) => {
            const active = mode === o.mode
            return (
              <button
                key={o.mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setThemeMode(o.mode)
                  setOpen(false)
                }}
                className={cx(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body-secondary',
                  'transition-colors duration-100 ease-cam',
                  active
                    ? 'bg-cam-selected font-medium text-cam-text-primary'
                    : 'text-cam-text-secondary hover:bg-cam-hover hover:text-cam-text-primary',
                )}
              >
                <span className="shrink-0 text-cam-text-tertiary [&_svg]:!h-[14px] [&_svg]:!w-[14px]">{o.icon}</span>
                <span className="min-w-0 flex-1">{o.label}</span>
                {active ? <IconCheck style={{ fontSize: 13 }} className="shrink-0 text-cam-text-secondary" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
