import { Button, Empty, Result, Skeleton, Spin } from '@arco-design/web-react'
import type { ReactNode } from 'react'

/** 全站统一的 Loading / Empty / Error 三态组件，禁止页面各造一份 */

/** 初次加载：骨架屏（模拟真实布局，不是一整块灰） */
export function InitialLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ padding: '16px 0' }}>
      <Skeleton
        loading
        animation
        text={{ rows, width: [280, 220, 240, 200, 260, 220] }}
      />
    </div>
  )
}

/** 局部刷新：不遮挡已有内容 */
export function InlineLoading({ text = '加载中…' }: { text?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '24px 0',
        color: 'var(--color-text-3)',
      }}
    >
      <Spin size={16} /> <span>{text}</span>
    </div>
  )
}

export function EmptyState({
  title = '暂无数据',
  description,
  action,
}: {
  title?: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      <Empty
        description={
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-2)', marginBottom: 4 }}
            >
              {title}
            </div>
            {description ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-3)', lineHeight: '20px' }}>
                {description}
              </div>
            ) : null}
          </div>
        }
      />
      {action ? <div style={{ marginTop: '16px' }}>{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = '加载失败',
  error,
  onRetry,
}: {
  title?: string
  error: string
  onRetry?: () => void
}) {
  return (
    <Result
      status="error"
      title={title}
      subTitle={error}
      extra={
        onRetry ? (
          <Button type="primary" onClick={onRetry}>
            重新加载
          </Button>
        ) : undefined
      }
      style={{ padding: '24px 0' }}
    />
  )
}
