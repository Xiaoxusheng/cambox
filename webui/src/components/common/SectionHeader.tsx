/**
 * 区块头：标题（15px/600）+ 可选描述（caption 次要）+ 右侧操作区。
 * 全站统一，替代每页手写标题行（Typography 随意字号禁止）。
 */
import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="text-section-title text-cam-text-primary">{title}</h3>
        {description ? <p className="mt-0.5 text-caption text-cam-text-tertiary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
