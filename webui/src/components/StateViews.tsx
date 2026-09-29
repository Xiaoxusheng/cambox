/**
 * 全站统一 Loading / Empty / Error 三态组件（页面禁止各造一份）。
 * 视觉语言 = camhub：实体深色 Surface + 细边框 + 克制动效；骨架必须按真实布局分块，
 * 不做整块灰底；错误态必须回答「发生了什么 / 为什么 / 怎么办」（任务书 §38）。
 */
import { Button } from '@arco-design/web-react'
import { IconExclamationCircle, IconRefresh } from '@arco-design/web-react/icon'
import type { ReactNode } from 'react'
import { cx } from '../utils/cx'

/** 初次加载骨架：块状占位模拟真实卡片布局（标题行 + 内容两行），不是一整块灰 */
export function InitialLoading({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-3', className)} aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-panel border border-cam-border bg-cam-surface p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="h-4 w-32 animate-pulse rounded bg-cam-active" />
            <div className="h-4 w-16 animate-pulse rounded bg-cam-active" />
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="h-3 w-2/3 animate-pulse rounded bg-cam-active" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-cam-active" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 局部刷新：居中 spinner + 文案，不遮挡已有内容（轮询刷新禁止整页闪烁） */
export function InlineLoading({ text = '加载中…', className }: { text?: string; className?: string }) {
  return (
    <div
      className={cx(
        'flex items-center justify-center gap-2 py-6 text-caption text-cam-text-tertiary',
        className,
      )}
    >
      <span className="h-3.5 w-3.5 animate-spin rounded-full border border-cam-text-4 border-t-transparent" />
      <span>{text}</span>
    </div>
  )
}

/** 空态：标题 + 说明 + 可选操作；不做大图标大插画（任务书 §64：空态可以没有 Icon） */
export function EmptyState({
  title = '暂无数据',
  description,
  action,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="text-body font-medium text-cam-text-primary">{title}</div>
      {description ? (
        <div className="mt-1 max-w-[360px] text-caption leading-5 text-cam-text-tertiary">{description}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** 错误态：发生了什么（title）+ 为什么（error）+ 怎么办（提示 + 重试）；小图标不夸张 */
export function ErrorState({
  title = '加载失败',
  error,
  onRetry,
  className,
}: {
  title?: string
  error: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="flex items-center gap-1.5 text-body font-medium text-cam-text-primary">
        <IconExclamationCircle style={{ fontSize: 15 }} className="text-cam-danger" />
        {title}
      </div>
      <div className="mt-1.5 max-w-[420px] break-all text-caption leading-5 text-cam-text-tertiary">{error}</div>
      <div className="mt-0.5 text-caption text-cam-text-tertiary">请检查网络与服务状态，然后重试。</div>
      {onRetry ? (
        <Button type="outline" size="small" icon={<IconRefresh />} onClick={onRetry} className="mt-4">
          重新加载
        </Button>
      ) : null}
    </div>
  )
}
