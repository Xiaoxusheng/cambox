/**
 * 异步数据 hook —— 统一承载 Loading / Error / 取消 / 轮询，禁止页面各写一套。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText, isAbortError } from '../api/errors'

export interface AsyncResult<T> {
  data: T | null
  /** 首次/换参加载中（骨架屏用）；轮询刷新不会置 true */
  loading: boolean
  error: string | null
  /** 手动重新加载（会重新展示 loading） */
  reload: () => void
}

export interface UseAsyncOptions {
  /** >0 时后台轮询，静默刷新不打断界面 */
  pollMs?: number
  /** false 时不发请求（例如依赖参数未就绪） */
  enabled?: boolean
}

export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  opts: UseAsyncOptions = {},
): AsyncResult<T> {
  const { pollMs, enabled = true } = opts
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const ac = new AbortController()
    let timer: number | undefined

    const run = async (primary: boolean) => {
      if (primary) setLoading(true)
      try {
        const result = await fnRef.current(ac.signal)
        if (ac.signal.aborted) return
        setData(result)
        setError(null)
      } catch (e) {
        if (ac.signal.aborted || isAbortError(e)) return
        setError(errorText(e))
      } finally {
        if (primary && !ac.signal.aborted) setLoading(false)
      }
    }

    void run(true)
    if (pollMs && pollMs > 0) {
      timer = window.setInterval(() => void run(false), pollMs)
    }
    return () => {
      ac.abort()
      if (timer) window.clearInterval(timer)
    }
    // 依赖由调用方声明；fn 每次渲染变化不入依赖（用 ref 取最新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled, pollMs])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { data, loading, error, reload }
}
