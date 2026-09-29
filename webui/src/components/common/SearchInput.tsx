/**
 * SearchInput —— 全站统一搜索输入（v1.4.2 精修）。
 * 32px 高、6px 圆角、极低对比底与描边（bg-cam-hover / border-cam-border）；
 * Focus 只做轻微 Border Brightening（border-cam-border-strong），无蓝色 Glow（任务书 §9/16）。
 * 原生 input 实现，不走 Arco Input，保证视觉完全受 token 控制。
 */
import { IconClose, IconSearch } from '@arco-design/web-react/icon'
import { cx } from '../../utils/cx'

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  ariaLabel,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel: string
  /** 宽度走响应式类：默认 移动全宽 / sm 起 240px（任务书 §31） */
  className?: string
}) {
  return (
    <div
      className={cx(
        'inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-cam-border bg-cam-hover px-2',
        'transition-colors duration-150 ease-cam focus-within:border-cam-border-strong',
        'sm:w-60',
        className,
      )}
    >
      <IconSearch style={{ fontSize: 13 }} className="shrink-0 text-cam-text-tertiary" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-full w-full bg-transparent text-body text-cam-text-primary outline-none placeholder:text-cam-text-4"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => onChange('')}
          className="shrink-0 text-cam-text-4 transition-colors duration-150 ease-cam hover:text-cam-text-secondary"
        >
          <IconClose style={{ fontSize: 12 }} />
        </button>
      ) : null}
    </div>
  )
}
