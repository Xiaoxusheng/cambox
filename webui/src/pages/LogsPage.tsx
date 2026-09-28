/**
 * /logs 日志（v1.3 按 camhub-ui-4k/07 设计稿重做）
 * EventSource 消费 GET /api/logs/stream（契约 §3.3）：先回放缓冲区再实时推送。
 * 支持级别筛选、级别着色、暂停接收、清屏；贴底自动滚动。终端风格等宽排版。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Select } from '@arco-design/web-react'
import { IS_MOCK } from '../api/client'
import { openLogStream } from '../api/logStream'
import type { LogEntry } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, InlineLoading } from '../components/StateViews'

const MAX_LINES = 2000

const LEVEL_OPTIONS = [
  { label: '全部级别', value: '' },
  { label: 'DEBUG', value: 'DEBUG' },
  { label: 'INFO', value: 'INFO' },
  { label: 'WARN', value: 'WARN' },
  { label: 'ERROR', value: 'ERROR' },
]

type ConnState = 'connecting' | 'open' | 'error'

function hhmmss(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [level, setLevel] = useState('')
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
  }, [entries, paused, level])

  const onScroll = () => {
    const el = viewRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const shown = useMemo(
    () => (level ? entries.filter((e) => e.level === level) : entries),
    [entries, level],
  )

  const connView =
    conn === 'open' ? (
      <span className="ch-livebar-item" style={{ color: 'var(--ch-ok)' }}>
        <span className="ch-status-dot ok" />
        已连接
      </span>
    ) : conn === 'connecting' ? (
      <span className="ch-livebar-item" style={{ color: 'var(--ch-warn)' }}>
        <span className="ch-status-dot warn" />
        连接中
      </span>
    ) : (
      <span className="ch-livebar-item" style={{ color: 'var(--ch-danger)' }}>
        <span className="ch-status-dot err" />
        连接中断
      </span>
    )

  return (
    <>
      <PageHeader
        title="日志"
        description={
          <>
            SSE 实时推送 · 环形缓冲 <span className="num">{MAX_LINES}</span> 条 · 贴底自动滚动
            {IS_MOCK ? '（当前为 mock 模拟流）' : ''}
          </>
        }
      />

      <div className="ch-filterbar">
        <Select
          value={level}
          onChange={setLevel}
          options={LEVEL_OPTIONS}
          style={{ width: 150 }}
          aria-label="日志级别筛选"
        />
        <span className="ch-muted num">
          共 {entries.length} 条
          {level ? ` · 显示 ${shown.length} 条` : ''} · 警告{' '}
          {entries.filter((e) => e.level === 'WARN').length} · 错误{' '}
          {entries.filter((e) => e.level === 'ERROR').length}
        </span>
        <span className="ch-filterbar-spacer" />
        {connView}
        <button
          type="button"
          className={`ch-btn ${paused ? '' : ''}`}
          onClick={() => {
            setPaused((p) => !p)
            if (paused) {
              stickRef.current = true
            }
          }}
        >
          {paused ? '▶ 继续' : '❚❚ 暂停'}
        </button>
        <button
          type="button"
          className="ch-btn danger"
          disabled={entries.length === 0}
          onClick={() => setEntries([])}
        >
          清屏
        </button>
      </div>

      {streamError ? (
        <div className="ch-note danger ch-gap-md">{streamError}</div>
      ) : null}
      {paused ? (
        <div className="ch-note ch-gap-md">
          已暂停接收，暂停期间的新日志不会显示；点「继续」恢复。
        </div>
      ) : null}

      <section className="ch-panel">
        <div className="ch-log-view" ref={viewRef} onScroll={onScroll}>
          {shown.length === 0 ? (
            conn === 'connecting' && entries.length === 0 ? (
              <InlineLoading text="正在连接日志流…" />
            ) : (
              <EmptyState
                title={level ? `没有 ${level} 级别的日志` : '暂无日志'}
                description={
                  level
                    ? '切换级别筛选，或选择「全部级别」查看所有日志。'
                    : '服务启动后产生的日志会实时显示在这里。'
                }
                action={
                  level ? (
                    <button type="button" className="ch-btn sm" onClick={() => setLevel('')}>
                      显示全部级别
                    </button>
                  ) : undefined
                }
              />
            )
          ) : (
            shown.map((e, i) => (
              <div className="ch-log-line" key={`${i}-${e.time}`}>
                <span className="ch-log-time num">{hhmmss(e.time)}</span>
                <span className={`ch-log-level ${e.level}`}>{e.level}</span>
                <span className="ch-log-msg">{e.msg}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  )
}
