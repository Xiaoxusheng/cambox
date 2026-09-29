/**
 * 事件列表（监控台「实时事件」与概览「最新事件」共用）—— v1.3 轻量重绘。
 * 视觉 = Tailwind cam.* 主样式层：72×48 缩略图 + 类型（语义色）+ 副标题 + mono 时间；
 * hover 克制（bg 变化 150ms，禁 scale）；空态单行提示（监控台右栏不留大空白）。
 * 导出签名保持不变（MonitorPage / DashboardPage 零改动兼容）。
 */
import { mediaUrl } from '../api/media'
import type { Event } from '../api/types'
import { eventAccent, eventSubLabel, eventTypeLabel, formatTime } from '../utils/format'
import { cx } from '../utils/cx'

/** 事件类型 → 语义色文字（token 唯一来源，页面禁止自配色） */
function toneText(e: Event): string {
  const accent = eventAccent(e.type, e.detail)
  if (accent === 'cyan') return 'text-cam-accent'
  if (accent === 'warn') return 'text-cam-warning'
  if (accent === 'danger') return 'text-cam-danger'
  return 'text-cam-text-primary'
}

export function EventList({
  items,
  cameraName,
  onItemClick,
  className,
}: {
  items: Event[]
  /** motion 事件副标题里的相机名 */
  cameraName?: string
  onItemClick?: (e: Event) => void
  className?: string
}) {
  if (items.length === 0) {
    return (
      <div className={cx('px-3 py-10 text-center text-caption text-cam-text-tertiary', className)}>
        暂无事件
      </div>
    )
  }
  return (
    <ul className={cx('m-0 flex list-none flex-col p-0', className)}>
      {items.map((e, i) => {
        const clickable = typeof onItemClick === 'function'
        return (
          <li key={e.id ?? i}>
            <button
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onItemClick(e) : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-lg p-2 text-left',
                'transition-colors duration-150 ease-cam',
                clickable && 'cursor-pointer hover:bg-cam-active',
              )}
            >
              <img
                src={mediaUrl(e.image)}
                alt=""
                loading="lazy"
                className="h-12 w-[72px] shrink-0 rounded-md border border-cam-border bg-cam-active object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-caption font-medium', toneText(e))}>
                  {eventTypeLabel(e.type, e.detail)}
                  {e.type === 'motion' ? (
                    <span className="cam-num ml-1.5 font-normal text-cam-text-tertiary">
                      得分 {e.score}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-caption text-cam-text-tertiary">
                  {eventSubLabel(e.type, cameraName)} · <span className="cam-num">{formatTime(e.time)}</span>
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
