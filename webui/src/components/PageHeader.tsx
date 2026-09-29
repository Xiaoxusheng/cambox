/**
 * 全站统一页头：标题（20px/600 page-title token）+ 描述（13px 次要）+ 右侧操作区。
 * 视觉全部 Tailwind cam.* token；禁止页面自造标题行与随意字号（任务书 §13）。
 */
import type { ReactNode } from 'react'
import { cx } from '../utils/cx'

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-page-title text-cam-text-primary">{title}</h1>
        {description ? (
          <p className="mt-1 text-body-secondary text-cam-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
