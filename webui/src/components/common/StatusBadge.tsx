/**
 * 状态徽章：呼吸点 + 语义色文字（在线 / 离线 / 录像中 / 布防中…）。
 * 颜色只来自 cam.* token（状态语义见 DECISIONS #15），页面禁止自配色；
 * 呼吸动画仅用于「活着」的状态（在线 / REC），2.4s 极弱透明度呼吸，不闪烁不放大。
 */
import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral'

const TONE_TEXT: Record<BadgeTone, string> = {
  success: 'text-cam-success',
  warning: 'text-cam-warning',
  danger: 'text-cam-danger',
  info: 'text-cam-info',
  accent: 'text-cam-accent',
  neutral: 'text-cam-text-tertiary',
}

export function StatusBadge({
  tone,
  label,
  breathe = false,
  className,
}: {
  tone: BadgeTone
  label: ReactNode
  /** 状态点呼吸（在线 / REC 用） */
  breathe?: boolean
  className?: string
}) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-caption', TONE_TEXT[tone], className)}>
      <span className={cx('h-1.5 w-1.5 rounded-full bg-current', breathe && 'animate-breathe')} />
      {label}
    </span>
  )
}
