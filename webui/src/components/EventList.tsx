/**
 * 事件列表（监控台「实时事件」与概览「最新事件」共用）—— v1.4 紧凑重绘。
 * 视觉 = Tailwind cam.* 主样式层：缩略图 + 类型（语义点仅自检异常上色）+ mono 时间；
 * score / 相机名作为 metadata 弱化（任务书 §30：不成为视觉中心）；
 * hover 克制（bg 变化 150ms，禁 scale）；空态单行提示（右栏不留大空白）。
 * 导出签名保持不变（MonitorPage / DashboardPage 零改动兼容）。
 */
import { mediaUrl } from '../api/media'
import type { Event } from '../api/types'
import { eventAccent, eventTypeLabel, formatTime } from '../utils/format'
import { cx } from '../utils/cx'

/** 语义点颜色：只有画面冻结 / 画面异常上语义色，移动侦测保持中性（任务书 §68 少颜色） */
function toneDot(e: Event): string {
  const accent = eventAccent(e.type, e.detail)
  if (accent === 'warn') return 'bg-cam-warning'
  if (accent === 'danger') return 'bg-cam-danger'
  return 'bg-cam-text-tertiary'
}

export function EventList({
  items,
  cameraName,
  onItemClick,
  className,
  /** 紧凑变体（System Overview 最新事件）：缩略图更小、行更紧（任务书 §28） */
  compact = false,
}: {
  items: Event[]
  /** motion 事件 metadata 里的相机名 */
  cameraName?: string
  onItemClick?: (e: Event) => void
  className?: string
  compact?: boolean
}) {
  if (items.length === 0) {
    return (
      <div className={cx('px-3 py-10 text-center text-caption text-cam-text-tertiary', className)}>
        暂无事件
      </div>
    )
  }
  return (
    <ul className={cx('m-0 flex list-none flex-col gap-0.5 p-0', className)}>
      {items.map((e, i) => {
        const clickable = typeof onItemClick === 'function'
        return (
          <li key={e.id ?? i} className="border-b border-cam-border last:border-b-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onItemClick(e) : undefined}
              className={cx(
                'flex w-full items-center gap-2.5 px-1.5 text-left',
                compact ? 'py-1.5' : 'py-2',
                'transition-colors duration-150 ease-cam',
                clickable && 'cursor-pointer hover:bg-cam-hover',
              )}
            >
              <img
                src={mediaUrl(e.image)}
                alt=""
                loading="lazy"
                className={cx('shrink-0 rounded-md bg-cam-active object-cover', compact ? 'h-9 w-14' : 'h-10 w-16')}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', toneDot(e))} />
                  <span className="truncate text-body-secondary font-medium text-cam-text-primary">
                    {eventTypeLabel(e.type, e.detail)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption text-cam-text-tertiary">
                  <span className="cam-num">{formatTime(e.time)}</span>
                  {e.type === 'motion' ? (
                    <>
                      {cameraName ? <span className="truncate">{cameraName}</span> : null}
                      <span className="cam-num text-cam-text-4">score {e.score}</span>
                    </>
                  ) : (
                    <span>画面自检 C3</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
