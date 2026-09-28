/**
 * /recordings 录像管理（v1.3 按 camhub-ui-4k/05 设计稿重做）
 * 存储水位卡 + 搜索卡 + 自绘表格（模式徽章 / 大小 / 起止 / 下载 / 删除）+ 分页 pill。
 * 模式徽章按 camera.type 推断（rtsp/url → 流复制，其余 → 编码），非逐文件事实，Tooltip 注明。
 */
import { useMemo, useState } from 'react'
import { Input, Message, Modal, Tooltip } from '@arco-design/web-react'
import { IconRefresh, IconSearch } from '@arco-design/web-react/icon'
import { deleteRecording, fetchConfig, fetchRecordings, fetchStatus } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { Config, RecordFile, RecordingsResponse, Status } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { formatBytes, formatDateTime, formatTime } from '../utils/format'

/** 同一天只显示时刻（设计稿 05：17:12:01 → 17:53:46），跨天带日期 */
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

type Data = [RecordingsResponse, Status, Config]

function modeBadge(camType: string) {
  const copy = camType === 'rtsp' || camType === 'url'
  const label = copy ? '流复制' : '编码'
  return (
    <Tooltip content="按当前来源类型推断的录制模式（历史分段可能不同）">
      <span className={`ch-badge ${copy ? 'cyan' : ''}`}>{label}</span>
    </Tooltip>
  )
}

/** 分页页码列表（同事件中心） */
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

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return kw ? items.filter((r) => r.name.toLowerCase().includes(kw)) : items
  }, [items, keyword])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItemsView = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  )
  const pagerList = useMemo(() => pageItems(pages, page), [pages, page])

  const diskPct = Math.min(100, maxGb > 0 ? (totalSize / (maxGb * 1024 ** 3)) * 100 : 0)

  const onDelete = (file: RecordFile) => {
    Modal.confirm({
      title: '删除该录像？',
      content: (
        <>
          文件 <span className="num">{file.name}</span>（{formatBytes(file.size_bytes)}
          ）将被永久删除，操作不可恢复。
        </>
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
            共 <span className="num">{items.length}</span> 个分段 ·{' '}
            <span className="num">{formatBytes(totalSize)}</span> · 按天数与容量自动循环清理
            {IS_MOCK ? '（mock 模式不生成模拟录像文件）' : ''}
          </>
        }
        actions={
          <button type="button" className="ch-btn" onClick={reload} aria-label="刷新">
            <IconRefresh />
            刷新
          </button>
        }
      />

      <div className="ch-filterbar" style={{ alignItems: 'stretch' }}>
        <section className="ch-panel" style={{ flex: '1 1 420px' }}>
          <div className="ch-panel-body" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span className="ch-stat-label" style={{ margin: 0 }}>
                存储水位
              </span>
              <span className="ch-filterbar-spacer" />
              <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                {formatBytes(totalSize)} / {maxGb} GB · {diskPct.toFixed(0)}%
              </span>
            </div>
            <div className="ch-meter" style={{ marginTop: 10 }} role="progressbar" aria-valuenow={Math.round(diskPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`存储使用率 ${diskPct.toFixed(1)}%`}>
              <span
                className="ch-meter-fill"
                style={{
                  display: 'block',
                  width: `${diskPct}%`,
                  background:
                    diskPct >= 90 ? 'var(--ch-danger)' : diskPct >= 75 ? 'var(--ch-warn)' : 'var(--ch-primary)',
                }}
              />
            </div>
            <div className="ch-muted num" style={{ marginTop: 8 }}>
              {retentionDays > 0 ? `retention ${retentionDays} 天 · ` : ''}到达 {maxGb} GB
              后自动清理最旧分段
            </div>
          </div>
        </section>

        <section className="ch-panel" style={{ flex: '1 1 380px' }}>
          <div className="ch-panel-body" style={{ padding: '14px 18px' }}>
            <div className="ch-stat-label" style={{ marginBottom: 10 }}>
              搜索分段
            </div>
            <Input
              value={keyword}
              onChange={(v) => {
                setKeyword(v)
                setPage(1)
              }}
              placeholder="seg_1712…"
              prefix={<IconSearch />}
              allowClear
              aria-label="按文件名筛选"
            />
          </div>
        </section>
      </div>

      <section className="ch-panel ch-tablecard">
        <div className="ch-table-wrap">
          <table className="ch-table rows-cards">
            <thead>
              <tr>
                <th>文件名</th>
                <th style={{ width: 120 }}>模式</th>
                <th style={{ width: 110 }}>
                  大小
                  <span className="ch-sort-arrow" title="按文件名倒序排列，大小仅供参考">
                    ↓
                  </span>
                </th>
                <th style={{ width: 300 }}>起止</th>
                <th style={{ width: 130, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageItemsView.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      title={keyword ? '没有匹配的录像文件' : '暂无录像'}
                      description={
                        keyword
                          ? '换个关键字试试，或清空筛选条件。'
                          : '开启录像后，每段录像会按 %Y-%m-%d_%H-%M-%S.mp4 命名并出现在这里。'
                      }
                      action={
                        keyword ? (
                          <button type="button" className="ch-btn sm" onClick={() => setKeyword('')}>
                            清空筛选
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                pageItemsView.map((r) => {
                  const url = recordingUrl(r.name)
                  return (
                    <tr key={r.name}>
                      <td className="num">{r.name}</td>
                      <td>{modeBadge(camType)}</td>
                      <td className="num">{formatBytes(r.size_bytes)}</td>
                      <td className="num" style={{ color: 'var(--ch-text-2)' }}>
                        {r.start && r.end ? (
                          <>{rangeText(r.start, r.end)}</>
                        ) : (
                          <Tooltip content="文件名未匹配 %Y-%m-%d_%H-%M-%S.mp4，无法解析起止时间">
                            <span>无法解析</span>
                          </Tooltip>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {url ? (
                          <a className="ch-linkbtn" href={url} download={r.name}>
                            下载
                          </a>
                        ) : (
                          <Tooltip content="mock 模式无真实文件可下载">
                            <span className="ch-linkbtn" style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                              下载
                            </span>
                          </Tooltip>
                        )}
                        <button
                          type="button"
                          className="ch-linkbtn danger"
                          style={{ marginLeft: 14, opacity: deletingName === r.name ? 0.5 : 1 }}
                          disabled={deletingName === r.name}
                          onClick={() => onDelete(r)}
                        >
                          {deletingName === r.name ? '删除中…' : '删除'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="ch-table-footer">
          <span className="ch-muted">
            共 <span className="num">{filtered.length}</span> 段 · 第 <span className="num">{page}</span> /{' '}
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
            {pagerList.map((p, i) =>
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
    </>
  )
}
