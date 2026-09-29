/**
 * /events 事件工作区 —— CamBox Event Workspace（v1.4 Linear-style 重构，任务书 §32~34）。
 * 布局：筛选行（类型/异常/日期区间/重置/刷新）+ 按日分组的紧凑列表 + 底部分页
 *       + 右侧 Drawer 详情（大图 + 元数据 + 查看回放，不跳页面）。
 * 保留全部逻辑：v1.2 §3.3 detail 精确筛选、批量删除（二次确认）、删后回退页码、mock/real 双模式。
 * 「查看回放」通过 /playback?date=&t= 带参跳转（t = 当日秒偏移），复用回放页既有跳转逻辑。
 */
import { useMemo, useState } from 'react'
import { Button, Checkbox, DatePicker, Drawer, Message, Modal, Pagination, Select } from '@arco-design/web-react'
import { IconDelete, IconPlayArrow, IconRefresh } from '@arco-design/web-react/icon'
import { useNavigate } from 'react-router-dom'
import { batchDeleteEvents, fetchEvents, fetchStatus, fetchTimeline } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Event, EventType, TimelineData } from '../api/types'
import { AutoCropImage } from '../components/AutoCropImage'
import { IconButton } from '../components/common/IconButton'
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

/** 当日秒偏移（回放带参跳转用） */
function secOfDayLocal(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}

/** 事件时间 → 分组键（YYYY-MM-DD）与显示标签（今天 / 昨天 / M-DD） */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabel(iso: string): string {
  const today = toLocalDateStr(new Date())
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const key = dayKey(iso)
  if (key === today) return '今天'
  if (key === toLocalDateStr(y)) return '昨天'
  return key
}

/** 类型语义点：只有画面冻结 / 画面异常上色（任务书 §68 少颜色） */
function TypeDot({ e }: { e: Event }) {
  const tone =
    e.type === 'motion'
      ? 'bg-cam-text-tertiary'
      : e.detail === 'frozen'
        ? 'bg-cam-warning'
        : 'bg-cam-danger'
  return <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tone)} />
}

function detailText(e: Event, cameraName: string): string {
  if (e.type === 'motion') return `${cameraName} · score ${e.score} · ${e.image ? '快照已存' : '无快照'}`
  return e.detail === 'frozen' ? '画面连续静止，疑似冻结' : '画面突变，疑似被遮挡或移动'
}

export function EventsPage() {
  const [type, setType] = useState<TypeFilter>('')
  const [detailFilter, setDetailFilter] = useState<DetailFilter>('')
  const [range, setRange] = useState<string[] | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [detail, setDetail] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()

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
  const { data: timeline } = useAsync<TimelineData>(signal => fetchTimeline(today, signal), [today])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const cameraName = data?.cameraName ?? ''
  const todayCount = timeline ? timeline.hourly.reduce((a, b) => a + b, 0) : 0

  // 按日分组（服务端已按时间倒序，页面内顺序分组即可）
  const dayGroups = useMemo(() => {
    const groups: { key: string; label: string; items: Event[] }[] = []
    for (const e of items) {
      const key = dayKey(e.time)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.items.push(e)
      else groups.push({ key, label: dayLabel(e.time), items: [e] })
    }
    return groups
  }, [items])

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

  /** 详情 → 回放：带上日期与当日秒偏移 */
  const viewRecording = (e: Event) => {
    navigate(`/playback?date=${encodeURIComponent(dayKey(e.time))}&t=${secOfDayLocal(e.time)}`)
  }

  if (loading && !data) return <InitialLoading rows={5} />

  return (
    <>
      {/* ---------- 页头：总数 / 今日 ---------- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-page-title text-cam-text-primary">事件</h2>
          <p className="mt-1.5 text-body-secondary text-cam-text-tertiary">
            共 {total} 条 · 今日 {todayCount} 条 · 按时间倒序
            {error && !data ? <span className="text-cam-danger"> · 加载失败：{error}</span> : null}
          </p>
        </div>
        <Button
          status="danger"
          icon={<IconDelete />}
          disabled={selected.length === 0 || deleting}
          loading={deleting}
          onClick={onBatchDelete}
        >
          删除选中{selected.length > 0 ? ` · ${selected.length}` : ''}
        </Button>
      </div>

      {/* ---------- 筛选行（任务书 §33：只放最常用，不一行塞十个 Select） ---------- */}
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
          className="h-8 rounded-md border border-cam-border px-3 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:border-cam-border-strong hover:text-cam-text-primary disabled:pointer-events-none disabled:opacity-40"
        >
          重置
        </button>
        <IconButton icon={<IconRefresh />} label="刷新" onClick={() => reload()} />
        <span className="cam-num ml-auto hidden text-caption text-cam-text-tertiary md:inline">
          每页 {PAGE_SIZE} 条
        </span>
      </div>

      {/* ---------- 按日分组的事件列表 ---------- */}
      <div className="rounded-panel border border-cam-border bg-cam-surface">
        {items.length === 0 ? (
          <EmptyState
            title={hasFilter ? '没有符合条件的事件' : '还没有事件'}
            description={
              hasFilter ? '试着放宽类型或日期范围。' : '布防状态下侦测到移动或画面异常时，事件会记录在这里。'
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
            {/* 全选行 */}
            <div className="flex items-center gap-3 border-b border-cam-border px-4 py-2">
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={toggleAll}
                aria-label="全选本页事件"
              />
              <span className="text-caption text-cam-text-tertiary">全选本页</span>
            </div>

            {dayGroups.map((g) => (
              <section key={g.key}>
                <h3 className="border-b border-cam-border bg-cam-elevated/60 px-4 py-1.5 text-caption font-medium text-cam-text-tertiary">
                  {g.label}
                  <span className="cam-num ml-2 text-cam-text-disabled">{g.key}</span>
                </h3>
                <ul className="m-0 list-none p-0">
                  {g.items.map((e) => {
                    const checked = selected.includes(e.id)
                    return (
                      <li
                        key={e.id}
                        className={cx(
                          'flex items-center gap-3 border-b border-cam-border px-4 py-2 last:border-b-0',
                          'transition-colors duration-150 ease-cam',
                          checked ? 'bg-cam-selected' : 'hover:bg-cam-hover',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleOne(e.id)}
                          aria-label={`选择事件 ${formatDateTimeFull(e.time)}`}
                        />
                        <span className="cam-num w-16 shrink-0 text-body-secondary tabular-nums text-cam-text-secondary">
                          {formatDateTime(e.time).slice(6)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDetail(e)}
                          className="min-w-0 flex-1 text-left"
                          aria-label={`查看事件详情：${eventTypeLabel(e.type, e.detail)}`}
                        >
                          <span className="flex items-center gap-1.5">
                            <TypeDot e={e} />
                            <span className="truncate text-body-secondary font-medium text-cam-text-primary">
                              {eventTypeLabel(e.type, e.detail)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-caption text-cam-text-tertiary">
                            {detailText(e, cameraName)}
                          </span>
                        </button>
                        <img
                          src={mediaUrl(e.image)}
                          alt={`${eventTypeLabel(e.type, e.detail)}快照`}
                          loading="lazy"
                          className="hidden h-[45px] w-[80px] shrink-0 cursor-pointer rounded border border-cam-border bg-cam-active object-cover sm:block"
                          onClick={() => setDetail(e)}
                        />
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setDetail(e)}
                            className="h-8 rounded-md px-2.5 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-hover hover:text-cam-text-primary"
                          >
                            查看
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteOne(e)}
                            className="h-8 rounded-md px-2.5 text-body-secondary text-cam-text-tertiary transition-colors duration-150 ease-cam hover:bg-cam-danger/10 hover:text-cam-danger"
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}

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
      </div>

      {/* ---------- 详情 Drawer（任务书 §34：不跳页面） ---------- */}
      <Drawer
        visible={!!detail}
        width={440}
        title="事件详情"
        footer={null}
        onCancel={() => setDetail(null)}
        unmountOnExit
      >
        {detail ? (
          <div className="flex flex-col gap-4">
            <AutoCropImage src={mediaUrl(detail.image)} alt="事件快照" radius={8} />
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-cam-text-tertiary">类型</span>
                <span className="flex items-center gap-1.5 text-body-secondary text-cam-text-primary">
                  <TypeDot e={detail} />
                  {eventTypeLabel(detail.type, detail.detail)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-cam-text-tertiary">时间</span>
                <span className="cam-num text-body-secondary text-cam-text-primary">
                  {formatDateTimeFull(detail.time)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-cam-text-tertiary">摄像头</span>
                <span className="text-body-secondary text-cam-text-primary">{cameraName}</span>
              </div>
              {detail.type === 'motion' ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-cam-text-tertiary">Score</span>
                  <span className="cam-num text-body-secondary text-cam-text-primary">{detail.score}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-cam-text-tertiary">检测</span>
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
            <div className="mt-1 flex items-center gap-2">
              <Button type="primary" icon={<IconPlayArrow />} onClick={() => viewRecording(detail)}>
                查看回放
              </Button>
              <Button status="danger" type="text" onClick={() => deleteOne(detail)}>
                删除事件
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  )
}
