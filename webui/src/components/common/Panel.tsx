/**
 * 统一面板：内容区实体 Surface（rounded-panel + cam-border + cam-surface）。
 * 深色 UI 用 border + surface 层级制造对比，不用大阴影；玻璃拟态仅限顶栏 / HUD / 浮动工具条。
 */
import type { HTMLAttributes } from 'react'
import { cx } from '../../utils/cx'

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-panel border border-cam-border bg-cam-surface', className)} {...rest} />
}
