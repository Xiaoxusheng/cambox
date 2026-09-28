/**
 * /events 事件中心
 * 类型 / 日期区间筛选 + 分页 + 快照预览 + 多选批量删除（二次确认）。
 */
import { useMemo, useState } from 'react'
import {
  Button,
  DatePicker,
  Image,
  Message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { IconDelete, IconEye, IconRefresh } from '@arco-design/web-react/icon'
import { batchDeleteEvents, fetchEvents } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Event, EventType } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { eventTypeLabel, formatDateTime } from '../utils/format'

type TypeFilter = '' | EventType

const PAGE_SIZE_DEFAULT = 20

const TYPE_OPTIONS = [
  { label: '全部类型', value: '' },
  { label: '移动侦测', value: 'motion' },
  { label: '画面自检（冻结 / 异常）', value: 'selfcheck' },
]

function typeTag(e: Event) {
  if (e.type === 'motion') return <Tag color="arcoblue" size="small">移动侦测</Tag>
  if (e.detail === 'frozen') return <Tag color="orange" size="small">画面冻结</Tag>
  return <Tag color="red" size="small">画面异常</Tag>
}

const dayStart = (s: string) => new Date(`${s}T00:00:00`).toISOString()
const dayEnd = (s: string) => new Date(`${s}T23:59:59.999`).toISOString()

export function EventsPage() {
  const [type, setType] = useState<TypeFilter>('')
  const [range, setRange] = useState<string[] | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [selected, setSelected] = useState<number[]>([])
  const [detail, setDetail] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState(false)

  const from = range?.[0] ? dayStart(range[0]) : undefined
  const to = range?.[1] ? dayEnd(range[1]) : undefined

  const { data, loading, error, reload } = useAsync(
    (signal) =>
      fetchEvents(
        { limit: pageSize, offset: (page - 1) * pageSize, type, from, to },
        signal,
      ),
    [page, pageSize, type, from, to],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const hasFilter = type !== '' || range !== null

  const resetFilter = () => {
    setType('')
    setRange(null)
    setPage(1)
    setSelected([])
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

  const columns = useMemo(
    () => [
      {
        title: '快照',
        dataIndex: 'image',
        width: 108,
        render: (_: unknown, e: Event) => (
          <Image
            src={mediaUrl(e.image)}
            width={88}
            height={50}
            alt={`${eventTypeLabel(e.type, e.detail)}快照`}
            style={{ objectFit: 'cover', borderRadius: 4, display: 'block' }}
            preview
          />
        ),
      },
      {
        title: '时间',
        dataIndex: 'time',
        width: 180,
        render: (v: string) => <span className="num">{formatDateTime(v)}</span>,
      },
      {
        title: '类型',
        dataIndex: 'type',
        width: 130,
        render: (_: unknown, e: Event) => typeTag(e),
      },
      {
        title: '得分',
        dataIndex: 'score',
        width: 100,
        render: (v: number, e: Event) =>
          e.type === 'motion' ? <span className="num">{v}</span> : <span className="ch-muted">—</span>,
      },
      {
        title: '说明',
        dataIndex: 'detail',
        render: (_: unknown, e: Event) => (
          <span className="ch-muted">
            {e.type === 'selfcheck'
              ? e.detail === 'frozen'
                ? '画面连续静止，疑似冻结'
                : '画面发生突变，疑似被遮挡或移动'
              : '检测区域内有移动变化'}
          </span>
        ),
      },
      {
        title: '操作',
        width: 96,
        render: (_: unknown, e: Event) => (
          <Button size="mini" type="text" icon={<IconEye />} onClick={() => setDetail(e)}>
            详情
          </Button>
        ),
      },
    ],
    [],
  )

  if (loading && !data) return <InitialLoading rows={4} />

  return (
    <>
      <PageHeader
        title="事件中心"
        description="移动侦测与画面自检事件记录，可预览快照、批量清理。"
        actions={
          <Button icon={<IconRefresh />} loading={loading} onClick={reload}>
            刷新
          </Button>
        }
      />
      <Panel
        title="筛选"
        extra={
          <Space>
            <Button
              status="danger"
              icon={<IconDelete />}
              disabled={selected.length === 0}
              loading={deleting}
              onClick={onBatchDelete}
            >
              批量删除{selected.length > 0 ? `（${selected.length}）` : ''}
            </Button>
          </Space>
        }
        style={{ marginBottom: 'var(--ch-space-md)' }}
      >
        <div className="ch-toolbar">
          <Select
            value={type}
            onChange={(v) => {
              setType(v as TypeFilter)
              setPage(1)
              setSelected([])
            }}
            style={{ width: 220 }}
            options={TYPE_OPTIONS}
            aria-label="事件类型"
          />
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
          <Button disabled={!hasFilter} onClick={resetFilter}>
            重置筛选
          </Button>
          <span className="ch-header-spacer" />
          <span className="ch-muted num">共 {total} 条</span>
        </div>
      </Panel>

      <Panel bodyStyle={{ padding: 0 }}>
        {error && !data ? (
          <div style={{ padding: 'var(--ch-space-md)' }}>
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            data={items}
            loading={loading}
            borderCell={false}
            stripe={false}
            scroll={{ x: 880 }}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys.map(Number)),
              checkboxProps: () => ({ 'aria-label': '选择该事件' }),
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              sizeCanChange: true,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, ps) => {
                setPage(p)
                if (ps !== pageSize) setPageSize(ps)
              },
            }}
            noDataElement={
              <EmptyState
                title={hasFilter ? '没有符合条件的事件' : '暂无事件'}
                description={
                  hasFilter
                    ? '试着放宽类型或日期范围。'
                    : '布防状态下侦测到移动或画面异常时，事件会记录在这里。'
                }
                action={
                  hasFilter ? (
                    <Button size="small" onClick={resetFilter}>
                      清除筛选
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Panel>

      <Modal
        visible={!!detail}
        title="事件详情"
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        onCancel={() => setDetail(null)}
        autoFocus={false}
      >
        {detail ? (
          <>
            <img
              src={mediaUrl(detail.image)}
              alt="事件快照"
              style={{ width: '100%', borderRadius: 8, display: 'block' }}
            />
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: '22px' }}>
              <div>
                类型：{typeTag(detail)}
              </div>
              <div className="num">时间：{formatDateTime(detail.time)}</div>
              {detail.type === 'motion' ? (
                <div className="num">得分：{detail.score}</div>
              ) : (
                <div>自检结果：{detail.detail === 'frozen' ? '画面冻结' : '画面异常'}</div>
              )}
              <div className="ch-muted" style={{ wordBreak: 'break-all' }}>
                快照：{detail.image}
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  )
}
