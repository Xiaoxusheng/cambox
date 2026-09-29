/**
 * /logs 日志终端 —— CamBox Log Console（v1.4.2 精修，任务书 §8~17）。
 * 结构：Page Header → Toolbar（搜索/级别筛选/统计/连接控制）→ Log Workspace。
 * Workspace = 实体 Surface（8px 圆角 + border，非 Card 阴影）；行 = 24px CSS Grid
 * （72px 时间 / 56px 级别 / 1fr 消息），mono 12px/24px，hover 只浮 2.5% 底。
 * EventSource 消费 GET /api/logs/stream（契约 §3.3）；缓冲内搜索 / 级别筛选 / 暂停 / 清屏 /
 * 贴底自动滚动逻辑全部保留。级别色：INFO 中性 / DEBUG 灰 / WARN #D4A72C / ERROR #D65A5A。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconCheck, IconDown, IconPause, IconPlayArrow } from '@arco-design/web-react/icon'
import { IS_MOCK } from '../api/client'
import { openLogStream } from '../api/logStream'
import type { LogEntry } from '../api/types'
import { SearchInput } from '../components/common/SearchInput'
import { EmptyState, InlineLoading } from '../components/StateViews'
import { cx } from '../utils/cx'

const MAX_LINES = 2000

const LEVEL_OPTIONS = [
  { label: '全部级别', value: '' },
  { label: 'DEBUG', value: 'DEBUG' },
  { label: 'INFO', value: 'INFO' },
  { label: 'WARN', value: 'WARN' },
  { label: 'ERROR', value: 'ERROR' },
]

type ConnState = 'connecting' | 'open' | 'error'

/** 级别色（任务书 §16）：INFO #A1A1AA / DEBUG #71717A / WARN / ERROR 走降饱和 token */
function levelClass(level: string): string {
  if (level === 'ERROR') return 'text-cam-log-error'
  if (level === 'WARN') return 'text-cam-log-warn'
  if (level === 'INFO') return 'text-cam-text-2'
  return 'text-cam-text-3'
}

function hhmmss(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 级别筛选：安静的 dropdown（不做明显 Arco Select，任务书 §10） */
function LevelFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
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

  const label = LEVEL_OPTIONS.find((o) => o.value === value)?.label ?? '全部级别'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="日志级别筛选"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-md border border-cam-border bg-cam-hover px-2.5',
          'text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam',
          'hover:border-cam-border-strong hover:text-cam-text-primary',
          open && 'border-cam-border-strong text-cam-text-primary',
        )}
      >
        {label}
        <IconDown style={{ fontSize: 11 }} className="text-cam-text-tertiary" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="日志级别"
          className="absolute left-0 top-full z-50 mt-1.5 w-36 animate-menu-in rounded-lg border border-cam-border-strong bg-cam-elevated p-1 shadow-popover"
        >
          {LEVEL_OPTIONS.map((o) => {
            const active = value === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(o.value)
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
                <span className="min-w-0 flex-1">{o.label}</span>
                {active ? <IconCheck style={{ fontSize: 13 }} className="shrink-0 text-cam-text-tertiary" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [level, setLevel] = useState('')
  const [keyword, setKeyword] = useState('')
  const [conn, setConn] = useState<ConnState>('connecting')
  const [streamError, setStreamError] = useState<string | null>(null)

  const viewRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const stickRef = useRef(true)

  useEffect(() => {
    // 重连（含 StrictMode 双挂载）时清空：SSE 会重放缓冲区，不清空会重复
    setEntries([])
    setConn('connecting')
    setStreamError(null)
    const close = openLogStream({
      onOpen: () => {
        setConn('open')
        setStreamError(null)
      },
      onEntry: (entry) => {
        if (pausedRef.current) return
        setEntries((prev) => {
          const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice()
          next.push(entry)
          return next
        })
      },
      onError: (msg) => {
        setConn('error')
        setStreamError(msg)
      },
    })
    return close
  }, [])

  // 贴底自动滚动（用户主动上滑时不打断阅读）
  useEffect(() => {
    const el = viewRef.current
    if (!el || paused || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [entries, paused, level, keyword])

  const onScroll = () => {
    const el = viewRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const shown = useMemo(() => {
    let list = entries
    if (level) list = list.filter((e) => e.level === level)
    const kw = keyword.trim().toLowerCase()
    if (kw) list = list.filter((e) => e.msg.toLowerCase().includes(kw))
    return list
  }, [entries, level, keyword])

  const warnCount = entries.filter((e) => e.level === 'WARN').length
  const errorCount = entries.filter((e) => e.level === 'ERROR').length

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ---------- Page Header ---------- */}
      <div className="shrink-0">
        <h2 className="text-page-title text-cam-text-primary">日志</h2>
        <p className="mt-1.5 text-body-secondary text-cam-text-tertiary">
          SSE 实时推送 · 环形缓冲 {MAX_LINES} 条 · 贴底自动滚动
          {IS_MOCK ? '（当前为 mock 模拟流）' : ''}
        </p>
      </div>

      {/* ---------- Toolbar（32px；统计为小号 metadata，不挤在搜索后） ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchInput
          value={keyword}
          onChange={setKeyword}
          placeholder="在缓冲内搜索…"
          ariaLabel="搜索日志内容"
        />
        <LevelFilter value={level} onChange={setLevel} />

        {/* 统计 metadata：events 弱、warnings/errors 稍亮，红色只留给级别列 */}
        <span className="cam-num ml-1 hidden text-caption text-cam-text-3 sm:inline">
          {entries.length} events
          <span className="text-cam-text-2"> · {warnCount} warnings</span>
          <span className="text-cam-text-2"> · {errorCount} errors</span>
          {level || keyword ? <span className="text-cam-text-3"> · 显示 {shown.length}</span> : null}
        </span>

        {/* 连接控制：状态 + 次要操作 + ghost danger */}
        <span className="ml-auto flex items-center gap-2">
          {streamError ? (
            <span className="max-w-[280px] truncate text-caption text-cam-danger" title={streamError}>
              {streamError}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-caption">
              <span
                className={cx(
                  'h-1.5 w-1.5 rounded-full',
                  conn === 'open' && 'animate-breathe bg-cam-success',
                  conn === 'connecting' && 'animate-breathe bg-cam-warning',
                  conn === 'error' && 'bg-cam-danger',
                )}
              />
              <span
                className={cx(
                  conn === 'error' ? 'text-cam-danger' : 'text-cam-text-2',
                )}
              >
                {conn === 'open' ? 'Connected' : conn === 'connecting' ? 'Connecting' : 'Disconnected'}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setPaused((p) => !p)
              if (paused) stickRef.current = true
            }}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-body-secondary',
              'text-cam-text-secondary transition-colors duration-150 ease-cam',
              'hover:bg-cam-hover hover:text-cam-text-primary',
              paused && 'bg-cam-selected text-cam-text-primary',
            )}
          >
            {paused ? <IconPlayArrow style={{ fontSize: 13 }} /> : <IconPause style={{ fontSize: 13 }} />}
            {paused ? '继续' : '暂停'}
          </button>
          <button
            type="button"
            disabled={entries.length === 0}
            onClick={() => setEntries([])}
            className={cx(
              'inline-flex h-8 items-center rounded-md px-2.5 text-body-secondary',
              'text-cam-text-tertiary transition-colors duration-150 ease-cam',
              'hover:bg-cam-danger/10 hover:text-cam-danger',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            清屏
          </button>
        </span>
      </div>

      {paused ? (
        <div className="shrink-0 rounded-md border border-cam-border bg-cam-surface px-3 py-2 text-body-secondary text-cam-text-tertiary">
          已暂停接收，暂停期间的新日志不会显示；点「继续」恢复。
        </div>
      ) : null}

      {/* ---------- Log Workspace：flex-1 自适应高度（任务书 §50），实体 Surface 非 Card ---------- */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-cam-border bg-cam-surface p-3">
        <div
          ref={viewRef}
          onScroll={onScroll}
          className="cam-num min-h-0 flex-1 overflow-y-auto px-1 font-mono text-[12px]"
        >
          {shown.length === 0 ? (
            conn === 'connecting' && entries.length === 0 ? (
              <InlineLoading text="正在连接日志流…" />
            ) : (
              <EmptyState
                title={level || keyword ? '没有匹配的日志' : '暂无日志'}
                description={
                  level || keyword
                    ? '调整级别或关键字，或清空筛选查看全部日志。'
                    : '服务启动后产生的日志会实时显示在这里。'
                }
                action={
                  level || keyword ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLevel('')
                        setKeyword('')
                      }}
                      className={cx(
                        'h-8 rounded-md border border-cam-border px-3 text-body-secondary',
                        'text-cam-text-secondary transition-colors duration-150 ease-cam',
                        'hover:border-cam-border-strong hover:text-cam-text-primary',
                      )}
                    >
                      清空筛选
                    </button>
                  ) : undefined
                }
              />
            )
          ) : (
            <div className="py-1">
              {shown.map((e, i) => (
                <div
                  key={`${i}-${e.time}`}
                  className="grid h-6 grid-cols-[64px_48px_minmax(0,1fr)] items-center gap-2 rounded-sm px-1 text-[11px] transition-colors duration-150 ease-cam hover:bg-cam-hover sm:grid-cols-[72px_56px_minmax(0,1fr)] sm:gap-3 sm:text-[12px]"
                >
                  <span className="tabular-nums text-cam-log-time">{hhmmss(e.time)}</span>
                  <span className={cx('font-medium', levelClass(e.level))}>{e.level}</span>
                  <span className="truncate text-cam-text-3" title={e.msg}>
                    {e.msg}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
