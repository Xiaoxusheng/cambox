/**
 * 图标按钮：图标 + 必备 aria-label + Tooltip（悬浮说明）。
 * hover 克制：bg/border 变化 + 150ms；禁 scale 放大（监控软件要稳）。
 * disabled 时不包 Tooltip（禁用元素无悬浮，避免空浮层）。
 */
import { Tooltip } from '@arco-design/web-react'
import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'

export function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  className,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  /** 激活态（工具条开关等）：accent-dim 底 + accent 图标 */
  active?: boolean
  className?: string
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-md',
        'text-cam-text-secondary transition-colors duration-150 ease-cam',
        'hover:bg-cam-active hover:text-cam-text-primary',
        active && 'bg-cam-selected text-cam-text-primary',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {icon}
    </button>
  )
  return disabled ? button : <Tooltip content={label}>{button}</Tooltip>
}
