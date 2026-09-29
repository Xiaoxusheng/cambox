/**
 * /recordings 录像工作区 —— CamBox Recording Workspace（v1.4 Linear-style 重构，任务书 §39）。
 * 布局：存储摘要条（水位 + 保留策略）+ 搜索 + 文件管理器式列表行
 *       （文件名 mono / 起止 / 时长 / 大小 / 播放 / 下载 / 删除）+ 分页。
 * 保留全部逻辑：文件名搜索、客户端分页、删除二次确认、mock 下载禁用提示、模式按 camera.type 推断。
 * 「播放」通过 /playback?date=&t= 带参跳转到该分段起点（复用回放页跳转逻辑）。
 */
import { useMemo, useState } from 'react'
import { Input, Message, Modal, Pagination, Tooltip } from '@arco-design/web-react'
import { IconDelete, IconDownload, IconPlayArrow, IconRefresh, IconSearch, IconVideoCamera } from '@arco-design/web-react/icon'
import { useNavigate } from 'react-router-dom'
import { deleteRecording, fetchConfig, fetchRecordings, fetchStatus } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { RecordFile } from '../api/types'
import { IconButton } from '../components/common/IconButton'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { formatBytes, formatClockLong, formatDateTime, formatTime } from '../utils/format'

/** 同一天只显示时刻，跨天带日期 */
function rangeText(a: string, b: string): string {
  const da = new Date(a)
  const db = new Date(b)
  const sameDay =
    !Number.isNaN(da.getTime()) &&
    !Number.isNaN(db.getTime()) &&
    da.toDateString() === db.toDateString()
  return sameDay ? `${formatTime(a)} → ${formatTime(b)}` : `${formatDateTime(a)} → ${formatDateTime(b)}`
}

const PAGE_SIZE = 20

type Data = [
  { items: RecordFile[]; total_size_bytes: number },
  { disk: { max_gb: number } },
  { record: { retention_days: number }; camera: { type: string } },
]

export function RecordingsPage() {
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const navigate = useNavigate()

  const { data, loading, error, reload } = useAsync<Data>(
    (signal) => Promise.all([fetchRecordings(signal), fetchStatus(signal), fetchConfig(signal)]),
    [],
  )

  const items = data?.[0].items ?? []
  const totalSize = data?.[0].total_size_bytes ?? 0
  const maxGb = data?.[1].disk.max_gb ?? 0
  const retentionDays = data?.[2].record.retention_days ?? 0
  const camType = data?.[2].camera.type ?? ''
  const copy = camType === 'rtsp' || camType === 'url'

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return kw ? items.filter((r) => r.name.toLowerCase().includes(kw)) : items
  }, [items, keyword])

  const pageItemsView = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  )

  const diskPct = Math.min(100, maxGb > 0 ? (totalSize / (maxGb * 1024 ** 3)) * 100 : 0)

  /** 分段时长（start/end 可解析时）；解析失败返回 null */
  const durationOf = (r: RecordFile): string | null => {
    if (!r.start || !r.end) return null
    const sec = (new Date(r.end).getTime() - new Date(r.start).getTime()) / 1000
    if (!Number.isFinite(sec) || sec <= 0) return null
    return formatClockLong(sec)
  }

  const playAt = (r: RecordFile) => {
    if (!r.start) {
      Message.warning('该文件名无法解析起始时间，请从回放页时间轴进入')
      return
    }
    const d = new Date(r.start)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
    navigate(`/playback?date=${encodeURIComponent(date)}&t=${sec}`)
  }

  const onDelete = (file: RecordFile) => {
    Modal.confirm({
      title: '删除该录像？',
      content: (
        <span>
          文件 <span className="cam-num">{file.name}</span>（{formatBytes(file.size_bytes)}
          ）将被永久删除，操作不可恢复。
        </span>
      ),
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setDeletingName(file.name)
        try {
          await deleteRecording(file.name)
          Message.success(`已删除 ${file.name}`)
          reload()
        } catch (e) {
          Message.error(errorText(e))
        } finally {
          setDeletingName(null)
        }
      },
    })
  }

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  return (
    <>
      {/* ---------- 页头 + 存储摘要 + 搜索 ---------- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-page-title text-cam-text-primary">录像</h2>
          <p className="mt-0.5 text-body-secondary text-cam-text-tertiary">
            共 {items.length} 个分段 · {formatBytes(totalSize)} ·{' '}
            {retentionDays > 0 ? `保留 ${retentionDays} 天 · ` : ''}到达 {maxGb} GB 自动清理最旧分段
            {IS_MOCK ? ' · mock 模式不生成模拟录像文件' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-2 md:inline-flex" title="存储水位">
            <span className="h-1 w-28 overflow-hidden rounded-full bg-cam-active">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${diskPct}%`,
                  background:
                    diskPct >= 90
                      ? 'rgb(var(--cam-danger-rgb))'
                      : diskPct >= 75
                        ? 'rgb(var(--cam-warning-rgb))'
                        : 'rgba(255,255,255,0.4)',
                }}
              />
            </span>
            <span className="cam-num text-caption text-cam-text-tertiary">
              {diskPct.toFixed(0)}%
            </span>
          </span>
          <Input
            value={keyword}
            onChange={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            placeholder="按文件名搜索…"
            prefix={<IconSearch />}
            allowClear
            style={{ width: 210 }}
            aria-label="按文件名筛选"
          />
          <IconButton icon={<IconRefresh />} label="刷新" onClick={() => reload()} />
        </div>
      </div>

      {/* ---------- 文件列表 ---------- */}
      <div className="rounded-panel border border-cam-border bg-cam-surface">
        {pageItemsView.length === 0 ? (
          <EmptyState
            title={keyword ? '没有匹配的录像文件' : '还没有录像'}
            description={
              keyword ? '换个关键字试试。' : '开启录像后，每段录像会按 %Y-%m-%d_%H-%M-%S.mp4 命名并出现在这里。'
            }
            action={
              keyword ? (
                <button
                  type="button"
                  onClick={() => setKeyword('')}
                  className="h-8 rounded-md border border-cam-border px-3 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:border-cam-border-strong hover:text-cam-text-primary"
                >
                  清空筛选
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="m-0 list-none p-0">
              {pageItemsView.map((r) => {
                const url = recordingUrl(r.name)
                const duration = durationOf(r)
                return (
                  <li
                    key={r.name}
                    className="group flex items-center gap-3 border-b border-cam-border px-4 py-2.5 transition-colors duration-150 ease-cam last:border-b-0 hover:bg-cam-active/60"
                  >
                    {/* 占位缩略块（契约无录像缩略图，诚实用图标占位） */}
                    <span className="flex h-10 w-[64px] shrink-0 items-center justify-center rounded border border-cam-border bg-cam-active text-cam-text-disabled">
                      <IconVideoCamera style={{ fontSize: 15 }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="cam-num truncate text-body-secondary text-cam-text-primary">{r.name}</div>
                      <div className="cam-num mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-cam-text-tertiary">
                        {r.start && r.end ? (
                          <span>{rangeText(r.start, r.end)}</span>
                        ) : (
                          <Tooltip content="文件名未匹配 %Y-%m-%d_%H-%M-%S.mp4，无法解析起止时间">
                            <span>时间无法解析</span>
                          </Tooltip>
                        )}
                        {duration ? <span>{duration}</span> : null}
                        <span>{formatBytes(r.size_bytes)}</span>
                        <span>{copy ? '流复制' : '编码'}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {url ? (
                        <>
                          <button
                            type="button"
                            onClick={() => playAt(r)}
                            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-hover hover:text-cam-text-primary"
                          >
                            <IconPlayArrow style={{ fontSize: 13 }} />
                            播放
                          </button>
                          <a
                            href={url}
                            download={r.name}
                            aria-label={`下载 ${r.name}`}
                            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-hover hover:text-cam-text-primary"
                          >
                            <IconDownload style={{ fontSize: 13 }} />
                            下载
                          </a>
                        </>
                      ) : (
                        <Tooltip content={IS_MOCK ? 'mock 模式无真实文件可下载' : '暂无下载地址'}>
                          <span className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-body-secondary text-cam-text-disabled opacity-60">
                            <IconDownload style={{ fontSize: 13 }} />
                            下载
                          </span>
                        </Tooltip>
                      )}
                      <button
                        type="button"
                        aria-label={`删除 ${r.name}`}
                        disabled={deletingName === r.name}
                        onClick={() => onDelete(r)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cam-text-tertiary transition-colors duration-150 ease-cam hover:bg-cam-danger/10 hover:text-cam-danger disabled:opacity-50"
                      >
                        <IconDelete style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-cam-border px-4 py-3">
              <span className="cam-num text-caption text-cam-text-tertiary">
                {filtered.length} 个分段
                {keyword ? `（已筛选，共 ${items.length}）` : ''}
              </span>
              <Pagination
                total={filtered.length}
                pageSize={PAGE_SIZE}
                current={page}
                sizeCanChange={false}
                onChange={(p) => setPage(p)}
                size="small"
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}
