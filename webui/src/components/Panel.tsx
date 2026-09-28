/**
 * 通用面板：一个有边界的内容区（Section 语义），比 Card 更克制。
 * 只在「需要独立边界」时使用，禁止层层套娃。
 */
import type { ReactNode } from 'react'

export function Panel({
  title,
  icon,
  extra,
  children,
  bodyStyle,
  style,
  className,
}: {
  title?: ReactNode
  /** 标题前的小图标（设计稿 02：趋势/事件面板标题带图标） */
  icon?: ReactNode
  extra?: ReactNode
  children: ReactNode
  bodyStyle?: React.CSSProperties
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <section className={className ? `ch-panel ${className}` : 'ch-panel'} style={style}>
      {title || extra ? (
        <header className="ch-panel-head">
          {icon ? <span className="ch-panel-icon">{icon}</span> : null}
          <div className="ch-panel-title">{title}</div>
          {extra ? <div className="ch-panel-extra">{extra}</div> : null}
        </header>
      ) : null}
      <div className="ch-panel-body" style={bodyStyle}>
        {children}
      </div>
    </section>
  )
}
