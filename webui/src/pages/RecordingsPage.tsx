/**
 * /recordings 录像管理
 * 存储水位条 + 录像表（名称/大小/起止/操作）+ 下载 + 删除（二次确认）。
 */
import { useMemo, useState } from 'react'
import { Button, Input, Message, Modal, Space, Table, Tooltip } from '@arco-design/web-react'
import { IconDelete, IconDownload, IconRefresh, IconSearch } from '@arco-design/web-react/icon'
import { deleteRecording, fetchRecordings, fetchStatus } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { RecordFile, RecordingsResponse, Status } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { StorageMeter } from '../components/StorageMeter'
import { useAsync } from '../hooks/useAsync'
import { formatBytes, formatDateTime } from '../utils/format'

type Data = [RecordingsResponse, Status]

export function RecordingsPage() {
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  const { data, loading, error, reload } = useAsync<Data>(
    (signal) => Promise.all([fetchRecordings(signal), fetchStatus(signal)]),
    [],
  )

  const items = data?.[0].items ?? []
  const totalSize = data?.[0].total_size_bytes ?? 0
  const maxGb = data?.[1].disk.max_gb ?? 0

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return kw ? items.filter((r) => r.name.toLowerCase().includes(kw)) : items
  }, [items, keyword])

  const onDelete = (file: RecordFile) => {
    Modal.confirm({
      title: '删除该录像？',
      content: (
        <>
          文件 <span className="num">{file.name}</span>（{formatBytes(file.size_bytes)}）将被永久删除，操作不可恢复。
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

  const columns = useMemo(
    () => [
      {
        title: '文件名',
        dataIndex: 'name',
        sorter: (a: RecordFile, b: RecordFile) => (a.name < b.name ? -1 : 1),
        render: (v: string) => <span className="num">{v}</span>,
      },
      {
        title: '大小',
        dataIndex: 'size_bytes',
        width: 120,
        sorter: (a: RecordFile, b: RecordFile) => a.size_bytes - b.size_bytes,
        render: (v: number) => <span className="num">{formatBytes(v)}</span>,
      },
      {
        title: '起止',
        dataIndex: 'start',
        width: 300,
        render: (_: unknown, r: RecordFile) =>
          r.start && r.end ? (
            <span className="num">
              {formatDateTime(r.start)} → {formatDateTime(r.end)}
            </span>
          ) : (
            <Tooltip content="文件名未匹配 %Y-%m-%d_%H-%M-%S.mp4，无法解析起止时间">
              <span className="ch-muted">无法解析</span>
            </Tooltip>
          ),
      },
      {
        title: '时长',
        width: 96,
        render: (_: unknown, r: RecordFile) => {
          if (!r.start || !r.end) return <span className="ch-muted">—</span>
          const sec = Math.max(0, (new Date(r.end).getTime() - new Date(r.start).getTime()) / 1000)
          return <span className="num">{Math.round(sec)}s</span>
        },
      },
      {
        title: '操作',
        width: 168,
        render: (_: unknown, r: RecordFile) => {
          const url = recordingUrl(r.name)
          return (
            <Space size={4}>
              {url ? (
                <a href={url} download={r.name}>
                  <Button size="mini" type="text" icon={<IconDownload />}>
                    下载
                  </Button>
                </a>
              ) : (
                <Tooltip content="mock 模式无真实文件可下载">
                  <Button size="mini" type="text" icon={<IconDownload />} disabled>
                    下载
                  </Button>
                </Tooltip>
              )}
              <Button
                size="mini"
                type="text"
                status="danger"
                icon={<IconDelete />}
                loading={deletingName === r.name}
                onClick={() => onDelete(r)}
              >
                删除
              </Button>
            </Space>
          )
        },
      },
    ],
    // onDelete 依赖 reload，二者每次渲染重建；列定义随语言与格式稳定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deletingName],
  )

  if (loading && !data) return <InitialLoading rows={4} />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  return (
    <>
      <PageHeader
        title="录像管理"
        description="按分段查看录像文件，可下载或删除；磁盘水位超过上限时系统会自动清理最早录像。"
        actions={
          <Button icon={<IconRefresh />} loading={loading} onClick={reload}>
            刷新
          </Button>
        }
      />

      <Panel title="存储水位" style={{ marginBottom: 'var(--ch-space-md)' }}>
        <StorageMeter usedBytes={totalSize} maxGb={maxGb} />
        <div className="ch-muted" style={{ marginTop: 8 }}>
          录像 {items.length} 个文件
          {IS_MOCK ? ' · mock 模式为模拟文件列表' : ''}
        </div>
      </Panel>

      <Panel
        title="录像文件"
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              value={keyword}
              onChange={(v) => {
                setKeyword(v)
                setPage(1)
              }}
              placeholder="按文件名筛选"
              prefix={<IconSearch />}
              allowClear
              style={{ width: 220 }}
            />
          </div>
        }
        bodyStyle={{ padding: 0 }}
      >
        <Table
          rowKey="name"
          columns={columns}
          data={filtered}
          loading={loading}
          borderCell={false}
          scroll={{ x: 900 }}
          pagination={{
            current: page,
            pageSize,
            total: filtered.length,
            sizeCanChange: true,
            showTotal: (t) => `共 ${t} 个文件`,
            onChange: (p, ps) => {
              setPage(p)
              if (ps !== pageSize) setPageSize(ps)
            },
          }}
          noDataElement={
            <EmptyState
              title={keyword ? '没有匹配的录像文件' : '暂无录像'}
              description={
                keyword
                  ? '换个关键字试试，或清空筛选条件。'
                  : '开启录像后，每段录像会按 %Y-%m-%d_%H-%M-%S.mp4 命名并出现在这里。'
              }
              action={
                keyword ? (
                  <Button size="small" onClick={() => setKeyword('')}>
                    清空筛选
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Panel>
    </>
  )
}
