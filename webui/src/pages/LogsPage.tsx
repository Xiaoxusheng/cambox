/**
 * /logs 日志终端 —— CamBox Log Console（v1.4 重构，任务书 §48）。
 * EventSource 消费 GET /api/logs/stream（契约 §3.3）：先回放缓冲区再实时推送。
 * 工具行（缓冲内搜索 / 级别筛选 / 计数 / 连接态 / 暂停 / 清屏）+ 凹陷终端视图（mono + 级别着色 + 贴底自动滚动）。
 * 级别色（任务书 §48）：INFO 中性 / WARN 黄 / ERROR 红 / DEBUG 灰，不用彩色大标签。
 * 逻辑保留：暂停期间不入列、贴底判定、级别筛选、清屏、重连清缓冲。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select } from '@arco-design/web-react'
import { IconCaretRight, IconPause, IconSearch } from '@arco-design/web-react/icon'
import { IS_MOCK } from '../api/client'
import { openLogStream } from '../api/logStream'
import type { LogEntry } from '../api/types'
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

/** 级别 → 中性/语义色（token 唯一来源）：INFO 中性，不用绿色大标签 */
function levelColor(level: string): string {
  if (level === 'ERROR') return 'text-cam-danger'
  if (level === 'WARN') return 'text-cam-warning'
  if (level === 'INFO') return 'text-cam-text-2'
  return 'text-cam-text-4'
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
    <div className="flex flex-col gap-3">
      {/* ---------- 页头 + 工具行 ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-page-title text-cam-text-primary">日志</h2>
          <p className="mt-0.5 text-body-secondary text-cam-text-tertiary">
            SSE 实时推送 · 环形缓冲 {MAX_LINES} 条 · 贴底自动滚动
            {IS_MOCK ? '（当前为 mock 模拟流）' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            type="outline"
            status="danger"
            size="small"
            disabled={entries.length === 0}
            onClick={() => setEntries([])}
          >
            清屏
          </Button>
        </div>
      </div>

      {/* 筛选行：缓冲内搜索 + 级别 + 计数 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={keyword}
          onChange={setKeyword}
          placeholder="在缓冲内搜索…"
          prefix={<IconSearch />}
          allowClear
          style={{ width: 220 }}
          aria-label="搜索日志内容"
        />
        <Select
          value={level}
          onChange={setLevel}
          options={LEVEL_OPTIONS}
          style={{ width: 140 }}
          aria-label="日志级别筛选"
        />
        <span className="cam-num text-caption text-cam-text-tertiary">
          共 {entries.length} 条{level || keyword ? ` · 显示 ${shown.length}` : ''} · 警告 {warnCount} · 错误{' '}
          {errorCount}
        </span>
      </div>

      {streamError ? (
        <div className="rounded-md border border-cam-danger/30 bg-cam-danger/10 px-3 py-2 text-body-secondary text-cam-danger">
          {streamError}
        </div>
      ) : null}
      {paused ? (
        <div className="rounded-md border border-cam-info/30 bg-cam-info/10 px-3 py-2 text-body-secondary text-cam-info">
          已暂停接收，暂停期间的新日志不会显示；点「继续」恢复。
        </div>
      ) : null}

      {/* ---------- 凹陷终端视图 ---------- */}
      <div className="rounded-panel border border-cam-border bg-cam-surface p-2">
        <div
          ref={viewRef}
          onScroll={onScroll}
          className="cam-num h-[calc(100dvh-320px)] min-h-[320px] overflow-auto rounded-md border border-cam-border bg-cam-sunken px-4 py-3 font-mono text-[12.5px] leading-5"
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
                    <Button
                      type="outline"
                      size="small"
                      onClick={() => {
                        setLevel('')
                        setKeyword('')
                      }}
                    >
                      清空筛选
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            shown.map((e, i) => (
              <div key={`${i}-${e.time}`} className="flex gap-3 whitespace-pre-wrap break-all">
                <span className="shrink-0 text-cam-text-4">{hhmmss(e.time)}</span>
                <span className={cx('w-11 shrink-0 font-semibold', levelColor(e.level))}>{e.level}</span>
                <span className="text-cam-text-secondary">{e.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
