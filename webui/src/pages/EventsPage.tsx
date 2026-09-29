/**
 * /events 事件中心 —— Arco Table 原生实现。
 * 类型 / 异常类型 / 日期区间筛选 + Table（rowSelection 多选、内置分页、loading、
 * hover 动画均为组件自带）+ 快照预览 + 删除。
 * 保留 v1.2 §3.3 的 detail 精确筛选（frozen / occlusion）。
 */
import { useState } from 'react'
import { Button, DatePicker, Message, Modal, Select, Space, Table, Tag, Tooltip, Typography } from '@arco-design/web-react'
import { IconDelete, IconRefresh } from '@arco-design/web-react/icon'
import type { ColumnProps } from '@arco-design/web-react/es/Table'
import { batchDeleteEvents, fetchEvents, fetchStatus, fetchTimeline } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Event, EventType, TimelineData } from '../api/types'
import { AutoCropImage } from '../components/AutoCropImage'
import { PageHeader } from '../components/PageHeader'
import { InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { eventTypeLabel, formatDateTime, formatDateTimeFull, toLocalDateStr } from '../utils/format'

const { Text } = Typography

type TypeFilter = '' | EventType
type DetailFilter = '' | 'frozen' | 'occlusion'

const PAGE_SIZE = 20

const TYPE_OPTIONS = [
  { label: '全部类型', value: '' },
  { label: '移动侦测', value: 'motion' },
  { label: '画面自检（冻结 / 异常）', value: 'selfcheck' },
]

const DETAIL_OPTIONS = [
  { label: '全部异常类型', value: '' },
  { label: '画面冻结', value: 'frozen' },
  { label: '画面异常', value: 'occlusion' },
]

const dayStart = (s: string) => new Date(`${s}T00:00:00`).toISOString()
const dayEnd = (s: string) => new Date(`${s}T23:59:59.999`).toISOString()

function typeTag(e: Event) {
  if (e.type === 'motion') return <Tag color="arcoblue">移动侦测</Tag>
  if (e.detail === 'frozen') return <Tag color="orange">画面冻结</Tag>
  return <Tag color="red">画面异常</Tag>
}

function detailText(e: Event, cameraName: string): string {
  if (e.type === 'motion') {
    return `得分 ${e.score} · ${cameraName} · ${e.image ? '快照已存' : '无快照'}`
  }
  return e.detail === 'frozen'
    ? '自检 C3 · 画面连续静止，疑似冻结'
    : '自检 C3 · 画面突变，疑似被遮挡或移动'
}

export function EventsPage() {
  const [type, setType] = useState<TypeFilter>('')
  const [detailFilter, setDetailFilter] = useState<DetailFilter>('')
  const [range, setRange] = useState<string[] | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [detail, setDetail] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState(false)

  const today = toLocalDateStr(new Date())
  const from = range?.[0] ? dayStart(range[0]) : undefined
  const to = range?.[1] ? dayEnd(range[1]) : undefined

  const { data, loading, error, reload } = useAsync(
    (signal) =>
      Promise.all([
        fetchEvents(
          { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, type, detail: detailFilter, from, to },
          signal,
        ),
        fetchStatus(signal),
      ]).then(([ev, st]) => ({ ...ev, cameraName: st.camera.name })),
    [page, type, detailFilter, from, to],
  )
  // 「今日 N 条」：今日 timeline 小时求和，低频刷新
  const { data: timeline } = useAsync<TimelineData>(
    (signal) => fetchTimeline(today, signal),
    [today],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const cameraName = data?.cameraName ?? ''
  const todayCount = timeline ? timeline.hourly.reduce((a, b) => a + b, 0) : 0

  const hasFilter = type !== '' || detailFilter !== '' || range !== null

  const resetFilter = () => {
    setType('')
    setDetailFilter('')
    setRange(null)
    setPage(1)
    setSelected([])
  }

  const deleteOne = (e: Event) => {
    Modal.confirm({
      title: '删除该事件？',
      content: (
        <>
          <Text>{formatDateTime(e.time)}</Text> 的
          {eventTypeLabel(e.type, e.detail)}记录与关联快照会一并删除，操作不可恢复。
        </>
      ),
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await batchDeleteEvents([e.id])
          Message.success('已删除')
          setSelected((prev) => prev.filter((x) => x !== e.id))
          if (items.length === 1 && page > 1) setPage((p) => p - 1)
          else reload()
        } catch (err) {
          Message.error(errorText(err))
        }
      },
    })
  }

  const onBatchDelete = () => {
    if (selected.length === 0) return
    Modal.confirm({
      title: `删除 ${selected.length} 条事件？`,
      content: '事件记录与关联的快照文件会一并删除，操作不可恢复。',
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setDeleting(true)
        try {
          const res = await batchDeleteEvents(selected)
          Message.success(`已删除 ${res.deleted} 条事件`)
          setSelected([])
          // 删除后当前页可能为空，回退一页
          if (items.length === selected.length && page > 1) setPage((p) => p - 1)
          else reload()
        } catch (e) {
          Message.error(errorText(e))
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  const columns: ColumnProps<Event>[] = [
    {
      title: '快照',
      width: 140,
      render: (_, e) => (
        <img
          src={mediaUrl(e.image)}
          alt={`${eventTypeLabel(e.type, e.detail)}快照`}
          loading="lazy"
          style={{
            width: 110,
            height: 62,
            objectFit: 'cover',
            borderRadius: 4,
            display: 'block',
            cursor: 'zoom-in',
            background: 'var(--color-fill-2)',
          }}
          onClick={() => setDetail(e)}
        />
      ),
    },
    { title: '类型', width: 120, render: (_, e) => typeTag(e) },
    {
      title: '时间',
      width: 190,
      sorter: false,
      render: (_, e) => <Text className="ch-num">{formatDateTimeFull(e.time)}</Text>,
    },
    {
      title: '详情',
      render: (_, e) => <Text type="secondary">{detailText(e, cameraName)}</Text>,
    },
    {
      title: '操作',
      width: 130,
      align: 'right',
      render: (_, e) => (
        <Space size={4}>
          <Button type="text" size="small" onClick={() => setDetail(e)}>
            查看
          </Button>
          <Button type="text" size="small" status="danger" onClick={() => deleteOne(e)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  if (loading && !data) return <InitialLoading rows={5} />

  return (
    <>
      <PageHeader
        title="事件中心"
        description={
          <>
            共 {total} 条记录 · 今日 {todayCount} 条
            {error && !data ? <Text type="error"> · 加载失败：{error}</Text> : null}
          </>
        }
        actions={
          <Button
            type="primary"
            status="danger"
            icon={<IconDelete />}
            disabled={selected.length === 0 || deleting}
            loading={deleting}
            onClick={onBatchDelete}
          >
            删除选中{selected.length > 0 ? ` · ${selected.length}` : ''}
          </Button>
        }
      />

      <Space size={12} style={{ marginBottom: 12 }} wrap>
        <Select
          value={type}
          onChange={(v) => {
            setType(v as TypeFilter)
            // detail 仅对画面自检有意义；切走时清掉避免静默空结果
            if (v !== 'selfcheck' && detailFilter !== '') setDetailFilter('')
            setPage(1)
            setSelected([])
          }}
          style={{ width: 200 }}
          options={TYPE_OPTIONS}
          aria-label="事件类型"
        />
        {type === 'selfcheck' ? (
          <Select
            value={detailFilter}
            onChange={(v) => {
              setDetailFilter(v as DetailFilter)
              setPage(1)
              setSelected([])
            }}
            style={{ width: 168 }}
            options={DETAIL_OPTIONS}
            aria-label="异常类型"
          />
        ) : null}
        <DatePicker.RangePicker
          value={range ?? undefined}
          format="YYYY-MM-DD"
          style={{ width: 260 }}
          placeholder={['开始日期', '结束日期']}
          onChange={(v) => {
            setRange(v && v.length === 2 ? [String(v[0]), String(v[1])] : null)
            setPage(1)
            setSelected([])
          }}
        />
        <Button type="outline" disabled={!hasFilter} onClick={resetFilter}>
          重置
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          按时间倒序 · 每页 {PAGE_SIZE} 条
        </Text>
        <Tooltip content="刷新">
          <Button type="text" icon={<IconRefresh />} aria-label="刷新" onClick={() => reload()} />
        </Tooltip>
      </Space>

      <Table<Event>
        rowKey="id"
        columns={columns}
        data={items}
        border={{ wrapper: false, cell: false }}
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as number[]),
          columnWidth: 44,
        }}
        pagination={{
          total,
          pageSize: PAGE_SIZE,
          current: page,
          sizeCanChange: false,
          onChange: (p) => setPage(p),
          showTotal: true,
        }}
        noDataElement={
          <div style={{ padding: '32px 0' }}>
            <Text type="secondary">
              {hasFilter ? '没有符合条件的事件，试着放宽类型或日期范围。' : '布防状态下侦测到移动或画面异常时，事件会记录在这里。'}
            </Text>
            {hasFilter ? (
              <div style={{ marginTop: 12 }}>
                <Button type="outline" size="small" onClick={resetFilter}>
                  清除筛选
                </Button>
              </div>
            ) : null}
          </div>
        }
      />

      <Modal
        visible={!!detail}
        title="事件详情"
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        onCancel={() => setDetail(null)}
        autoFocus={false}
      >
        {detail ? (
          <>
            <AutoCropImage src={mediaUrl(detail.image)} alt="事件快照" />
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: '22px' }}>
              <div>类型：{typeTag(detail)}</div>
              <div className="ch-num">时间：{formatDateTime(detail.time)}</div>
              {detail.type === 'motion' ? (
                <div className="ch-num">得分：{detail.score}</div>
              ) : (
                <div>自检结果：{detail.detail === 'frozen' ? '画面冻结' : '画面异常'}</div>
              )}
              <div style={{ wordBreak: 'break-all' }}>
                <Text type="secondary">快照：{detail.image}</Text>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  )
}
