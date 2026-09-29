/**
 * /recordings 录像管理 —— camhub v1.3 重设计（Phase 5）。
 * 布局（设计稿 05-录像管理 + 任务书 §29）：页头（段数/容量/循环清理）+ 存储摘要条（水位线 + 保留策略）
 * + 搜索 + 轻量列表行（文件名/起止/大小/模式/下载/删除）+ 底部分页。厚重 Table → 横向轻量列表。
 * 保留全部逻辑：文件名搜索、客户端分页、删除二次确认、mock 下载禁用提示、模式按 camera.type 推断。
 */
import { useMemo, useState } from 'react'
import { Input, Message, Modal, Pagination, Tooltip } from '@arco-design/web-react'
import { IconRefresh, IconSearch } from '@arco-design/web-react/icon'
import { deleteRecording, fetchConfig, fetchRecordings, fetchStatus } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { RecordFile } from '../api/types'
import { IconButton } from '../components/common/IconButton'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/common/Panel'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { cx } from '../utils/cx'
import { formatBytes, formatDateTime, formatTime } from '../utils/format'

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

type Data = [{ items: RecordFile[]; total_size_bytes: number }, { disk: { max_gb: number } }, { record: { retention_days: number }; camera: { type: string } }]

/** 录制模式 chip（rtsp/url → 流复制，其余 → 编码；按当前来源推断，历史分段可能不同） */
function ModeChip({ copy }: { copy: boolean }) {
  return (
    <Tooltip content="按当前来源类型推断的录制模式（历史分段可能不同）">
      <span
        className={cx(
          'inline-flex h-6 items-center rounded-md border px-2 text-caption font-medium',
          copy
            ? 'border-cam-info/30 bg-cam-info/10 text-cam-info'
            : 'border-cam-border bg-cam-active text-cam-text-secondary',
        )}
      >
        {copy ? '流复制' : '编码'}
      </span>
    </Tooltip>
  )
}

export function RecordingsPage() {
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [deletingName, setDeletingName] = useState<string | null>(null)

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
      <PageHeader
        title="录像管理"
        description={
          <>
            共 {items.length} 个分段 · {formatBytes(totalSize)} · 按天数与容量自动循环清理
            {IS_MOCK ? '（mock 模式不生成模拟录像文件）' : ''}
          </>
        }
        actions={<IconButton icon={<IconRefresh />} label="刷新" onClick={() => reload()} />}
      />

      {/* ---------- 存储摘要 + 搜索 ---------- */}
      <Panel className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
        <span className="text-caption text-cam-text-secondary">存储水位</span>
        <span className="hidden items-center gap-2 sm:inline-flex">
          <span className="h-1 w-32 overflow-hidden rounded-full bg-cam-active">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${diskPct}%`,
                background:
                  diskPct >= 90
                    ? 'rgb(var(--cam-danger-rgb))'
                    : diskPct >= 75
                      ? 'rgb(var(--cam-warning-rgb))'
                      : 'rgb(var(--cam-accent-rgb))',
              }}
            />
          </span>
          <span className="cam-num text-caption text-cam-text-tertiary">
            {formatBytes(totalSize)} / {maxGb} GB · {diskPct.toFixed(0)}%
          </span>
        </span>
        <span className="text-caption text-cam-text-tertiary">
          {retentionDays > 0 ? `保留 ${retentionDays} 天 · ` : ''}到达 {maxGb} GB 自动清理最旧分段
        </span>
        <div className="ml-auto">
          <Input
            value={keyword}
            onChange={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            placeholder="按文件名搜索…"
            prefix={<IconSearch />}
            allowClear
            style={{ width: 220 }}
            aria-label="按文件名筛选"
          />
        </div>
      </Panel>

      {/* ---------- 轻量录像列表 ---------- */}
      <Panel>
        {pageItemsView.length === 0 ? (
          <EmptyState
            title={keyword ? '没有匹配的录像文件' : '还没有录像'}
            description={
              keyword
                ? '换个关键字试试。'
                : '开启录像后，每段录像会按 %Y-%m-%d_%H-%M-%S.mp4 命名并出现在这里。'
            }
            action={
              keyword ? (
                <button
                  type="button"
                  onClick={() => setKeyword('')}
                  className="h-8 rounded-lg border border-cam-border px-3 text-caption text-cam-text-secondary transition-colors duration-150 ease-cam hover:border-cam-border-strong hover:text-cam-text-primary"
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
                return (
                  <li
                    key={r.name}
                    className="flex items-center gap-3 border-b border-cam-border px-4 py-2.5 transition-colors duration-150 ease-cam last:border-b-0 hover:bg-cam-active/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="cam-num truncate text-body-secondary text-cam-text-primary">
                        {r.name}
                      </div>
                      <div className="cam-num mt-0.5 text-caption text-cam-text-tertiary">
                        {r.start && r.end ? (
                          rangeText(r.start, r.end)
                        ) : (
                          <Tooltip content="文件名未匹配 %Y-%m-%d_%H-%M-%S.mp4，无法解析起止时间">
                            <span>时间无法解析</span>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    <span className="cam-num hidden w-20 shrink-0 text-right text-caption text-cam-text-secondary sm:inline">
                      {formatBytes(r.size_bytes)}
                    </span>
                    <span className="hidden md:inline">
                      <ModeChip copy={copy} />
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {url ? (
                        <a
                          href={url}
                          download={r.name}
                          className="inline-flex h-8 items-center rounded-lg px-2.5 text-caption text-cam-accent transition-colors duration-150 ease-cam hover:bg-cam-accent/10"
                        >
                          下载
                        </a>
                      ) : (
                        <Tooltip content={IS_MOCK ? 'mock 模式无真实文件可下载' : '暂无下载地址'}>
                          <span className="inline-flex h-8 items-center rounded-lg px-2.5 text-caption text-cam-text-tertiary opacity-50">
                            下载
                          </span>
                        </Tooltip>
                      )}
                      <button
                        type="button"
                        disabled={deletingName === r.name}
                        onClick={() => onDelete(r)}
                        className="inline-flex h-8 items-center rounded-lg px-2.5 text-caption text-cam-danger transition-colors duration-150 ease-cam hover:bg-cam-danger/10 disabled:opacity-50"
                      >
                        {deletingName === r.name ? '删除中…' : '删除'}
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
      </Panel>
    </>
  )
}
