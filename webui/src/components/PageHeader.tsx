/** 全站统一页头：标题 / 说明 / 右侧操作区 —— Arco Typography 实现 */
import type { ReactNode } from 'react'
import { Typography } from '@arco-design/web-react'

const { Title, Text } = Typography

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
      <div>
        <Title heading={4} style={{ marginTop: 0, marginBottom: 4 }}>
          {title}
        </Title>
        {description ? (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {description}
          </Text>
        ) : null}
      </div>
      {actions ? <div className="ch-page-actions">{actions}</div> : null}
    </div>
  )
}
