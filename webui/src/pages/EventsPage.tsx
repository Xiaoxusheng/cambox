/**
 * /events 事件中心（v1.3 按 camhub-ui-4k/03 设计稿重做）
 * 类型 / 异常类型 / 日期区间筛选 + 自绘表格（多选、快照预览、删除）+ 分页 pill。
 * 保留 v1.2 §3.3 的 detail 精确筛选（frozen / occlusion）。
 */
import { useMemo, useState } from 'react'
import { Button, DatePicker, Message, Modal, Select } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import { batchDeleteEvents, fetchEvents, fetchStatus, fetchTimeline } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl } from '../api/media'
import type { Event, EventType, TimelineData } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { eventTypeLabel, formatDateTime, toLocalDateStr } from '../utils/format'

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

function typeBadge(e: Event) {
  if (e.type === 'motion') return <span className="ch-badge cyan">移动侦测</span>
  if (e.detail === 'frozen') return <span className="ch-badge warn">画面冻结</span>
  return <span className="ch-badge danger">画面异常</span>
}

function detailText(e: Event, cameraName: string): string {
  if (e.type === 'motion') {
    return `得分 ${e.score} · ${cameraName} · ${e.image ? '快照已存' : '无快照'}`
  }
  return e.detail === 'frozen'
    ? '自检 C3 · 画面连续静止，疑似冻结'
    : '自检 C3 · 画面突变，疑似被遮挡或移动'
}

/** 分页页码列表：1 2 3 … 7（超过 7 页折叠省略号） */
function pageItems(total: number, cur: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, 2, total, cur - 1, cur, cur + 1])
  const list = [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const p of list) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
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
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const allChecked = items.length > 0 && items.every((e) => selected.includes(e.id))
  const someChecked = items.some((e) => selected.includes(e.id))

  const hasFilter = type !== '' || detailFilter !== '' || range !== null

  const resetFilter = () => {
    setType('')
    setDetailFilter('')
    setRange(null)
    setPage(1)
    setSelected([])
  }

  const toggleAll = () => {
    setSelected(allChecked ? [] : items.map((e) => e.id))
  }

  const toggleOne = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const deleteOne = (e: Event) => {
    Modal.confirm({
      title: '删除该事件？',
      content: (
        <>
          <span className="num">{formatDateTime(e.time)}</span> 的
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

  const pagerItems = useMemo(() => pageItems(pages, page), [pages, page])

  if (loading && !data) return <InitialLoading rows={5} />

  return (
    <>
      <PageHeader
        title="事件中心"
        description={
          <>
            共 <span className="num">{total}</span> 条记录 · 今日 <span className="num">{todayCount}</span> 条
            {error && !data ? (
              <span style={{ color: 'var(--ch-danger)' }}> · 加载失败：{error}</span>
            ) : null}
          </>
        }
        actions={
          <button
            type="button"
            className="ch-btn danger"
            disabled={selected.length === 0 || deleting}
            onClick={onBatchDelete}
          >
            删除选中{selected.length > 0 ? ` · ${selected.length}` : ''}
          </button>
        }
      />

      <div className="ch-filterbar">
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
        <button type="button" className="ch-btn" disabled={!hasFilter} onClick={resetFilter}>
          重置
        </button>
        <span className="ch-filterbar-spacer" />
        <span className="ch-muted">
          按时间倒序 · 每页 <span className="num">{PAGE_SIZE}</span> 条
        </span>
        <button
          type="button"
          className="ch-btn icon"
          aria-label="刷新"
          onClick={() => reload()}
        >
          <IconRefresh />
        </button>
      </div>

      <section className="ch-panel ch-tablecard">
        <div className="ch-table-wrap">
          <table className="ch-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    className="ch-check"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked && !allChecked
                    }}
                    onChange={toggleAll}
                    aria-label="全选本页"
                  />
                </th>
                <th style={{ width: 128 }}>快照</th>
                <th style={{ width: 120 }}>类型</th>
                <th style={{ width: 180 }}>时间</th>
                <th>详情</th>
                <th style={{ width: 120, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title={hasFilter ? '没有符合条件的事件' : '暂无事件'}
                      description={
                        hasFilter
                          ? '试着放宽类型或日期范围。'
                          : '布防状态下侦测到移动或画面异常时，事件会记录在这里。'
                      }
                      action={
                        hasFilter ? (
                          <button type="button" className="ch-btn sm" onClick={resetFilter}>
                            清除筛选
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="ch-check"
                        checked={selected.includes(e.id)}
                        onChange={() => toggleOne(e.id)}
                        aria-label="选择该事件"
                      />
                    </td>
                    <td>
                      <img
                        src={mediaUrl(e.image)}
                        alt={`${eventTypeLabel(e.type, e.detail)}快照`}
                        loading="lazy"
                        style={{
                          width: 88,
                          height: 50,
                          objectFit: 'cover',
                          borderRadius: 8,
                          display: 'block',
                          cursor: 'zoom-in',
                          background: '#0a1017',
                        }}
                        onClick={() => setDetail(e)}
                      />
                    </td>
                    <td>{typeBadge(e)}</td>
                    <td className="num">{formatDateTime(e.time)}</td>
                    <td style={{ color: 'var(--ch-text-2)' }}>{detailText(e, cameraName)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="ch-linkbtn" onClick={() => setDetail(e)}>
                        查看
                      </button>
                      <button
                        type="button"
                        className="ch-linkbtn danger"
                        style={{ marginLeft: 14 }}
                        onClick={() => deleteOne(e)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="ch-table-footer">
          <span className="ch-muted">
            共 <span className="num">{total}</span> 条 · 第 <span className="num">{page}</span> /{' '}
            <span className="num">{pages}</span> 页
          </span>
          <span className="ch-table-footer-spacer" />
          <div className="ch-pager">
            <button
              type="button"
              className="ch-pagebtn plain"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            {pagerItems.map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="ch-muted" style={{ padding: '0 2px' }}>
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={`ch-pagebtn ${p === page ? 'active' : ''}`}
                  onClick={() => setPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </button>
              ),
            )}
            <button
              type="button"
              className="ch-pagebtn plain"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>

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
              <div>类型：{typeBadge(detail)}</div>
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
