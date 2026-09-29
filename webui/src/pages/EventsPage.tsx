/**
 * /events 事件中心 —— camhub v1.3 重设计（Phase 5）。
 * 布局（设计稿 03-事件中心 + 任务书 §26~28）：页头（总数/今日）+ 筛选行（类型/异常/日期区间/重置/刷新）
 * + 轻量事件列表（复选框/缩略图/类型徽章/mono 时间/详情/操作）+ 底部分页 + 右侧 Drawer 详情（不跳页面）。
 * 保留全部逻辑：v1.2 §3.3 detail 精确筛选、批量删除（二次确认）、删后回退页码、mock/real 双模式。
 * 厚重 Arco Table → 轻量列表行（信息密度更高，缩略图 110×62）。
 */
import { useState } from 'react'
import {
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Message,
  Modal,
  Pagination,
  Select,
} from '@arco-design/web-react'
import { IconDelete, IconRefresh } from '@arco-design/web-react/icon'
import { batchDeleteEvents, fetchEvents, fetchStatus, fetchTimeline } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Event, EventType, TimelineData } from '../api/types'
import { AutoCropImage } from '../components/AutoCropImage'
import { IconButton } from '../components/common/IconButton'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/common/Panel'
import { EmptyState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { cx } from '../utils/cx'
import { eventTypeLabel, formatDateTime, formatDateTimeFull, toLocalDateStr } from '../utils/format'

const PAGE_SIZE = 20

type TypeFilter = '' | EventType
type DetailFilter = '' | 'frozen' | 'occlusion'

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

/** 类型徽章：语义色 chip（侦测=accent / 冻结=warning / 异常=danger），颜色只作辅助 */
function TypeChip({ e }: { e: Event }) {
  const [label, tone] =
    e.type === 'motion'
      ? (['移动侦测', 'accent'] as const)
      : e.detail === 'frozen'
        ? (['画面冻结', 'warning'] as const)
        : (['画面异常', 'danger'] as const)
  return (
    <span
      className={cx(
        'inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-caption font-medium',
        tone === 'accent' && 'border-cam-accent/30 bg-cam-accent/10 text-cam-accent',
        tone === 'warning' && 'border-cam-warning/30 bg-cam-warning/10 text-cam-warning',
        tone === 'danger' && 'border-cam-danger/30 bg-cam-danger/10 text-cam-danger',
      )}
    >
      {label}
    </span>
  )
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
        <span>
          {formatDateTime(e.time)} 的{eventTypeLabel(e.type, e.detail)}
          记录与关联快照会一并删除，操作不可恢复。
        </span>
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

  const allChecked = items.length > 0 && items.every((e) => selected.includes(e.id))
  const someChecked = items.some((e) => selected.includes(e.id)) && !allChecked

  const toggleAll = () => {
    setSelected(allChecked ? [] : items.map((e) => e.id))
  }

  const toggleOne = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  if (loading && !data) return <InitialLoading rows={5} />

  return (
    <>
      <PageHeader
        title="事件中心"
        description={
          <>
            共 {total} 条记录 · 今日 {todayCount} 条 · 按时间倒序
            {error && !data ? <span className="text-cam-danger"> · 加载失败：{error}</span> : null}
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

      {/* ---------- 筛选行（任务书 §27：少量筛选，不堆按钮） ---------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <button
          type="button"
          disabled={!hasFilter}
          onClick={resetFilter}
          className="h-8 rounded-lg border border-cam-border px-3 text-caption text-cam-text-secondary transition-colors duration-150 ease-cam hover:border-cam-border-strong hover:text-cam-text-primary disabled:pointer-events-none disabled:opacity-40"
        >
          重置
        </button>
        <IconButton icon={<IconRefresh />} label="刷新" onClick={() => reload()} />
        <span className="cam-num ml-auto hidden text-caption text-cam-text-tertiary md:inline">
          每页 {PAGE_SIZE} 条
        </span>
      </div>

      {/* ---------- 轻量事件列表 ---------- */}
      <Panel>
        {items.length === 0 ? (
          <EmptyState
            title={hasFilter ? '没有符合条件的事件' : '还没有事件'}
            description={
              hasFilter
                ? '试着放宽类型或日期范围。'
                : '布防状态下侦测到移动或画面异常时，事件会记录在这里。'
            }
            action={
              hasFilter ? (
                <Button type="outline" size="small" onClick={resetFilter}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* 表头：全选 */}
            <div className="flex items-center gap-3 border-b border-cam-border px-4 py-2">
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={toggleAll}
                aria-label="全选本页事件"
              />
              <span className="text-caption text-cam-text-tertiary">全选本页</span>
            </div>
            <ul>
              {items.map((e) => {
                const checked = selected.includes(e.id)
                return (
                  <li
                    key={e.id}
                    className={cx(
                      'flex items-center gap-3 border-b border-cam-border px-4 py-2.5 last:border-b-0',
                      'transition-colors duration-150 ease-cam',
                      checked ? 'bg-cam-accent/[0.06]' : 'hover:bg-cam-active/60',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => toggleOne(e.id)}
                      aria-label={`选择事件 ${formatDateTimeFull(e.time)}`}
                    />
                    <img
                      src={mediaUrl(e.image)}
                      alt={`${eventTypeLabel(e.type, e.detail)}快照`}
                      loading="lazy"
                      className="h-[62px] w-[110px] shrink-0 cursor-zoom-in rounded-md border border-cam-border bg-cam-active object-cover"
                      onClick={() => setDetail(e)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <TypeChip e={e} />
                        <span className="cam-num text-caption text-cam-text-secondary">
                          {formatDateTimeFull(e.time)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-caption text-cam-text-tertiary">
                        {detailText(e, cameraName)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDetail(e)}
                        className="h-8 rounded-lg px-2.5 text-caption text-cam-accent transition-colors duration-150 ease-cam hover:bg-cam-accent/10"
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteOne(e)}
                        className="h-8 rounded-lg px-2.5 text-caption text-cam-danger transition-colors duration-150 ease-cam hover:bg-cam-danger/10"
                      >
                        删除
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {/* 分页 */}
            <div className="flex items-center justify-end border-t border-cam-border px-4 py-3">
              <Pagination
                total={total}
                pageSize={PAGE_SIZE}
                current={page}
                sizeCanChange={false}
                onChange={(p) => setPage(p)}
                showTotal
                size="small"
              />
            </div>
          </>
        )}
      </Panel>

      {/* ---------- 详情 Drawer（任务书 §28：不跳页面） ---------- */}
      <Drawer
        visible={!!detail}
        width={480}
        title="事件详情"
        footer={null}
        onCancel={() => setDetail(null)}
        unmountOnExit
      >
        {detail ? (
          <div className="flex flex-col gap-4">
            <AutoCropImage src={mediaUrl(detail.image)} alt="事件快照" />
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-cam-text-tertiary">类型</span>
                <TypeChip e={detail} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-cam-text-tertiary">时间</span>
                <span className="cam-num text-body-secondary text-cam-text-primary">
                  {formatDateTimeFull(detail.time)}
                </span>
              </div>
              {detail.type === 'motion' ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-cam-text-tertiary">得分</span>
                  <span className="cam-num text-body-secondary text-cam-text-primary">{detail.score}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-cam-text-tertiary">自检结果</span>
                  <span className="text-body-secondary text-cam-text-primary">
                    {detail.detail === 'frozen' ? '画面冻结' : '画面异常'}
                  </span>
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-caption text-cam-text-tertiary">快照文件</span>
                <span className="cam-num break-all text-right text-caption text-cam-text-secondary">
                  {detail.image || '-'}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  )
}
