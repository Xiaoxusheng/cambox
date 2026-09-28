/**
 * 实时画面帧源。
 * 真实模式：MJPEG 单请求长连接（浏览器原生 multipart 解码），src 恒定。
 * mock 模式：无后端可连，按 4fps 轮换确定性 SVG 帧，保证 /live 与 ROI 编辑器可自查。
 */
import { useCallback, useEffect, useState } from 'react'
import { IS_MOCK, mockFrameSrc, streamUrl } from '../api/media'

export interface StreamFrame {
  src: string
  /** 画面加载失败（真实模式下相机未就绪） */
  failed: boolean
  markFailed: () => void
  retry: () => void
}

export function useStreamFrame(enabled: boolean): StreamFrame {
  const [seq, setSeq] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!IS_MOCK || !enabled) return
    const timer = window.setInterval(() => setSeq((s) => (s + 1) % 100000), 250)
    return () => window.clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    if (enabled) setFailed(false)
  }, [enabled])

  const src = !enabled ? '' : IS_MOCK ? mockFrameSrc(seq) : (streamUrl() ?? '')

  const markFailed = useCallback(() => setFailed(true), [])
  const retry = useCallback(() => {
    setFailed(false)
    setSeq(0)
  }, [])

  return { src, failed, markFailed, retry }
}
