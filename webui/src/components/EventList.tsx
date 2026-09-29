/**
 * 事件列表（监控「实时事件」与概览「最新事件」共用）—— Arco List 原生实现，
 * 行内动画、hover 反馈与空态均由 List 组件自带。
 */
import { Avatar, List, Tag, Typography } from '@arco-design/web-react'
import { mediaUrl } from '../api/media'
import type { Event } from '../api/types'
import { eventSubLabel, formatTime } from '../utils/format'

const { Text } = Typography

function typeTag(e: Event) {
  if (e.type === 'motion') return <Tag color="arcoblue" size="small">移动侦测</Tag>
  if (e.detail === 'frozen') return <Tag color="orange" size="small">画面冻结</Tag>
  return <Tag color="red" size="small">画面异常</Tag>
}

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
  return (
    <List
      size="small"
      dataSource={items}
      render={(e, index) => (
        <List.Item
          key={e.id || index}
          style={{ cursor: onItemClick ? 'pointer' : 'default' }}
          onClick={onItemClick ? () => onItemClick(e) : undefined}
        >
          <List.Item.Meta
            avatar={
              <Avatar shape="square" size={48} style={{ backgroundColor: 'var(--color-fill-2)' }}>
                <img
                  src={mediaUrl(e.image)}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Avatar>
            }
            title={
              <span>
                {typeTag(e)}
                {e.type === 'motion' ? (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                    得分 {e.score}
                  </Text>
                ) : null}
              </span>
            }
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {eventSubLabel(e.type, cameraName)} · {formatTime(e.time)}
              </Text>
            }
          />
        </List.Item>
      )}
    />
  )
}
