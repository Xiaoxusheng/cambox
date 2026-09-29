/**
 * CommandMenu —— ⌘K / Ctrl+K 命令面板（v1.4 新增，任务书 §51）。
 * dark popover + 小搜索框 + 分组命令 + 键盘快捷键；100~120ms 克制入场。
 * 仅做导航与主题切换等安全操作，不承载业务修改。开关状态由 AppLayout 持有（全局快捷键）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_SYSTEM, NAV_WORKSPACE } from './AppSidebar'
import { getThemeMode, resolvedTheme, setThemeMode } from '../../theme'
import { cx } from '../../utils/cx'

interface Command {
  key: string
  label: string
  hint?: string
  icon?: ReactNode
  run: () => void
}

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 每次打开重置
  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      // 等一帧让弹层挂载后再聚焦
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const groups = useMemo(() => {
    const navCommands: Command[] = [...NAV_WORKSPACE, ...NAV_SYSTEM].map((n) => ({
      key: n.key,
      label: n.label,
      hint: '跳转',
      icon: n.icon,
      run: () => navigate(n.key),
    }))
    const mode = getThemeMode()
    const resolved = resolvedTheme(mode)
    const next = resolved === 'dark' ? 'light' : 'dark'
    const actions: Command[] = [
      {
        key: 'toggle-theme',
        label:
          mode === 'system'
            ? '切换到' + (resolved === 'dark' ? '浅色' : '深色') + '模式（当前跟随系统）'
            : resolved === 'dark'
              ? '切换到浅色模式'
              : '切换到深色模式',
        hint: '主题',
        run: () => setThemeMode(next),
      },
    ]
    const q = query.trim().toLowerCase()
    const filter = (list: Command[]) => (q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list)
    return [
      { title: '导航', items: filter(navCommands) },
      { title: '操作', items: filter(actions) },
    ].filter((g) => g.items.length > 0)
  }, [navigate, query])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // 过滤结果变化时钳制选中项
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, flat.length - 1)))
  }, [flat.length])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const runCommand = (c: Command) => {
    onClose()
    c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = flat[index]
      if (c) runCommand(c)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let runningIndex = -1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="w-[min(560px,100%)] animate-menu-in overflow-hidden rounded-lg border border-cam-border-strong bg-cam-elevated shadow-overlay"
        onKeyDown={onKeyDown}
      >
        {/* 搜索输入行 */}
        <div className="flex items-center gap-2.5 border-b border-cam-border px-3.5">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索页面或操作…"
            aria-label="搜索命令"
            className="h-11 w-full bg-transparent text-body text-cam-text-primary outline-none placeholder:text-cam-text-disabled"
          />
          <kbd className="cam-num shrink-0 rounded border border-cam-border px-1.5 text-[10px] leading-[16px] text-cam-text-tertiary">
            ESC
          </kbd>
        </div>

        {/* 命令列表 */}
        <div ref={listRef} role="listbox" aria-label="命令列表" className="max-h-[320px] overflow-y-auto p-1.5">
          {flat.length === 0 ? (
            <div className="px-3 py-8 text-center text-body-secondary text-cam-text-tertiary">
              没有匹配「{query}」的命令
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.title}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-cam-text-tertiary">
                  {g.title}
                </div>
                {g.items.map((c) => {
                  runningIndex += 1
                  const i = runningIndex
                  const active = i === index
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-index={i}
                      onMouseEnter={() => setIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => runCommand(c)}
                      className={cx(
                        'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body-secondary',
                        'transition-colors duration-100 ease-cam',
                        active ? 'bg-cam-selected text-cam-text-primary' : 'text-cam-text-secondary',
                      )}
                    >
                      {c.icon ? (
                        <span className="shrink-0 text-cam-text-tertiary [&_svg]:!h-[14px] [&_svg]:!w-[14px]">
                          {c.icon}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.hint ? <span className="shrink-0 text-caption text-cam-text-disabled">{c.hint}</span> : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center gap-3 border-t border-cam-border px-3.5 py-2 text-caption text-cam-text-disabled">
          <span className="flex items-center gap-1">
            <kbd className="cam-num rounded border border-cam-border px-1 text-[10px] leading-[14px]">↑↓</kbd>
            选择
          </span>
          <span className="flex items-center gap-1">
            <kbd className="cam-num rounded border border-cam-border px-1 text-[10px] leading-[14px]">↵</kbd>
            确认
          </span>
        </div>
      </div>
    </div>
  )
}
