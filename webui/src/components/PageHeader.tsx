/** 全站统一页头：标题 / 说明 / 右侧操作区 */
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="ch-page-header">
      <div className="ch-page-header-main">
        <h1 className="ch-page-title">{title}</h1>
        {description ? <div className="ch-page-desc">{description}</div> : null}
      </div>
      {actions ? <div className="ch-page-actions">{actions}</div> : null}
    </div>
  )
}
