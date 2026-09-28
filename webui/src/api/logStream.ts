/**
 * 日志流适配：契约 §3.3 GET /api/logs/stream（SSE，先回放缓冲区再实时推送）。
 * 真实模式用 EventSource；mock 模式用等价的模拟流，页面代码完全一致。
 */
import { IS_MOCK } from './client'
import { mockLogEntry } from './mock'
import type { LogEntry } from './types'

export interface LogStreamHandlers {
  onEntry: (entry: LogEntry) => void
  onOpen?: () => void
  onError?: (message: string) => void
}

const MOCK_BACKLOG = 60

/** 打开日志流，返回关闭函数 */
export function openLogStream(h: LogStreamHandlers): () => void {
  if (IS_MOCK) {
    let seq = 1
    let closed = false
    let timer: number | undefined
    h.onOpen?.()
    // 先回放缓冲区（时间戳向前回溯，模拟真实的历史日志）
    for (let i = 0; i < MOCK_BACKLOG; i++) {
      if (closed) break
      h.onEntry(mockLogEntry(seq++, (MOCK_BACKLOG - i) * 3))
    }
    // 再实时推送
    const tick = () => {
      if (closed) return
      h.onEntry(mockLogEntry(seq++))
      timer = window.setTimeout(tick, 500 + Math.random() * 1400)
    }
    timer = window.setTimeout(tick, 600)
    return () => {
      closed = true
      if (timer) window.clearTimeout(timer)
    }
  }

  const es = new EventSource('/api/logs/stream')
  es.onopen = () => h.onOpen?.()
  es.onmessage = (ev: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(ev.data) as LogEntry
      if (parsed && typeof parsed.msg === 'string') h.onEntry(parsed)
    } catch {
      // 非 JSON 心跳等，忽略
    }
  }
  es.onerror = () => {
    // EventSource 会自动重连，这里只做状态提示
    h.onError?.('日志流连接中断，正在自动重连…')
  }
  return () => es.close()
}
