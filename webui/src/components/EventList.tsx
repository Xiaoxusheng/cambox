/**
 * 事件列表（监控侧栏「实时事件」与概览「最新事件」共用，v1.3 设计稿样式）。
 * 行：缩略图 + 标题（按类型着色）+ 副标题 + 等宽时间。
 */
import { mediaUrl } from '../api/media'
import type { Event } from '../api/types'
import {
  eventAccent,
  eventSubLabel,
  eventTypeLabel,
  formatTime,
} from '../utils/format'
import { EmptyState } from './StateViews'

export function EventList({
  items,
  cameraName,
  onItemClick,
}: {
  items: Event[]
  /** motion 事件副标题里的相机名 */
  cameraName?: string
  onItemClick?: (e: Event) => void
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="暂无事件"
        description="布防后有移动侦测或画面异常时，这里会出现最新记录。"
      />
    )
  }
  return (
    <div className="ch-event-list">
      {items.map((e) => {
        const accent = eventAccent(e.type, e.detail)
        const row = (
          <>
            <img className="ch-evthumb" src={mediaUrl(e.image)} alt="" loading="lazy" />
            <span className="ch-evmain">
              <span className={`ch-evtitle ${accent}`}>
                {eventTypeLabel(e.type, e.detail)}
                {e.type === 'motion' ? <span className="num"> · 得分 {e.score}</span> : null}
              </span>
              <span className="ch-evsub">{eventSubLabel(e.type, cameraName)}</span>
              <span className="ch-evsub num">{formatTime(e.time)}</span>
            </span>
          </>
        )
        return onItemClick ? (
          <button
            type="button"
            className="ch-evrow"
            key={e.id}
            onClick={() => onItemClick(e)}
            aria-label={`查看 ${formatTime(e.time)} 的${eventTypeLabel(e.type, e.detail)}`}
          >
            {row}
          </button>
        ) : (
          <div className="ch-evrow" key={e.id} style={{ cursor: 'default' }}>
            {row}
          </div>
        )
      })}
    </div>
  )
}
