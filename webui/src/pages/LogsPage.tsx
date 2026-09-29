/**
 * /logs 日志 —— camhub v1.3 重设计（Phase 7，终端风格）。
 * EventSource 消费 GET /api/logs/stream（契约 §3.3）：先回放缓冲区再实时推送。
 * 工具行（级别筛选/计数/连接态/暂停/清屏）+ 凹陷终端视图（mono + 级别着色 + 贴底自动滚动）。
 * 逻辑零丢失：暂停期间不入列、贴底判定、级别筛选、清屏、重连清缓冲。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select } from '@arco-design/web-react'
import { IconCaretRight, IconPause } from '@arco-design/web-react/icon'
import { IS_MOCK } from '../api/client'
import { openLogStream } from '../api/logStream'
import type { LogEntry } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/common/Panel'
import { StatusBadge } from '../components/common/StatusBadge'
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

/** 级别 → 语义色（token 唯一来源） */
function levelColor(level: string): string {
  if (level === 'ERROR') return 'text-cam-danger'
  if (level === 'WARN') return 'text-cam-warning'
  if (level === 'INFO') return 'text-cam-success'
  return 'text-cam-text-tertiary'
}

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

  const warnCount = entries.filter((e) => e.level === 'WARN').length
  const errorCount = entries.filter((e) => e.level === 'ERROR').length

  return (
    <>
      <PageHeader
        title="日志"
        description={
          <>
            SSE 实时推送 · 环形缓冲 {MAX_LINES} 条 · 贴底自动滚动
            {IS_MOCK ? '（当前为 mock 模拟流）' : ''}
          </>
        }
      />

      {/* ---------- 工具行 ---------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={level}
          onChange={setLevel}
          options={LEVEL_OPTIONS}
          style={{ width: 150 }}
          aria-label="日志级别筛选"
        />
        <span className="cam-num text-caption text-cam-text-tertiary">
          共 {entries.length} 条{level ? ` · 显示 ${shown.length}` : ''} · 警告 {warnCount} · 错误 {errorCount}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {conn === 'open' ? (
            <StatusBadge tone="success" label="已连接" breathe />
          ) : conn === 'connecting' ? (
            <StatusBadge tone="warning" label="连接中" breathe />
          ) : (
            <StatusBadge tone="danger" label="连接中断" />
          )}
          <Button
            type="outline"
            size="small"
            icon={paused ? <IconCaretRight /> : <IconPause />}
            onClick={() => {
              setPaused((p) => !p)
              if (paused) {
                stickRef.current = true
              }
            }}
          >
            {paused ? '继续' : '暂停'}
          </Button>
          <Button
            type="primary"
            status="danger"
            size="small"
            disabled={entries.length === 0}
            onClick={() => setEntries([])}
          >
            清屏
          </Button>
        </span>
      </div>

      {streamError ? (
        <div className="mb-3 rounded-lg border border-cam-danger/30 bg-cam-danger/10 px-3 py-2 text-caption text-cam-danger">
          {streamError}
        </div>
      ) : null}
      {paused ? (
        <div className="mb-3 rounded-lg border border-cam-info/30 bg-cam-info/10 px-3 py-2 text-caption text-cam-info">
          已暂停接收，暂停期间的新日志不会显示；点「继续」恢复。
        </div>
      ) : null}

      {/* ---------- 凹陷终端视图 ---------- */}
      <Panel className="p-2">
        <div
          ref={viewRef}
          onScroll={onScroll}
          className="cam-num h-[calc(100vh-340px)] min-h-[320px] overflow-auto rounded-lg border border-cam-border bg-cam-bg px-4 py-3 font-mono text-[12.5px] leading-5"
        >
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
                    <Button type="outline" size="small" onClick={() => setLevel('')}>
                      显示全部级别
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            shown.map((e, i) => (
              <div key={`${i}-${e.time}`} className="flex gap-3 whitespace-pre-wrap break-all">
                <span className="shrink-0 text-cam-text-tertiary">{hhmmss(e.time)}</span>
                <span className={cx('w-11 shrink-0 font-semibold', levelColor(e.level))}>{e.level}</span>
                <span className="text-cam-text-secondary">{e.msg}</span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </>
  )
}
