/**
 * /recordings 录像管理 —— Arco 组件原生实现。
 * 存储水位卡（Progress）+ 搜索卡 + Table（内置分页/loading）+ 下载/删除。
 * 模式 Tag 按 camera.type 推断（rtsp/url → 流复制，其余 → 编码），Tooltip 注明。
 */
import { useMemo, useState } from 'react'
import { Button, Card, Grid, Input, Message, Modal, Progress, Space, Table, Tag, Tooltip, Typography } from '@arco-design/web-react'
import { IconRefresh, IconSearch } from '@arco-design/web-react/icon'
import type { ColumnProps } from '@arco-design/web-react/es/Table'
import { deleteRecording, fetchConfig, fetchRecordings, fetchStatus } from '../api/endpoints'
import { errorText } from '../api/errors'
import { IS_MOCK, recordingUrl } from '../api/media'
import type { Config, RecordFile, RecordingsResponse, Status } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { formatBytes, formatDateTime, formatTime } from '../utils/format'

const { Text } = Typography
const { Row, Col } = Grid

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

type Data = [RecordingsResponse, Status, Config]

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

  const pageItemsView = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  )

  const diskPct = Math.min(100, maxGb > 0 ? (totalSize / (maxGb * 1024 ** 3)) * 100 : 0)
  const diskColor = diskPct >= 90 ? '--color-danger-6' : diskPct >= 75 ? '--color-warning-6' : '--color-primary-6'

  const onDelete = (file: RecordFile) => {
    Modal.confirm({
      title: '删除该录像？',
      content: (
        <>
          文件 <Text className="ch-num">{file.name}</Text>（{formatBytes(file.size_bytes)}
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

  const columns: ColumnProps<RecordFile>[] = [
    {
      title: '文件名',
      render: (_, r) => <Text className="ch-num">{r.name}</Text>,
    },
    {
      title: '模式',
      width: 120,
      render: () => {
        const copy = camType === 'rtsp' || camType === 'url'
        return (
          <Tooltip content="按当前来源类型推断的录制模式（历史分段可能不同）">
            <Tag color={copy ? 'arcoblue' : 'gray'} size="small">
              {copy ? '流复制' : '编码'}
            </Tag>
          </Tooltip>
        )
      },
    },
    { title: '大小', width: 110, render: (_, r) => <Text className="ch-num">{formatBytes(r.size_bytes)}</Text> },
    {
      title: '起止',
      width: 300,
      render: (_, r) =>
        r.start && r.end ? (
          <Text type="secondary" className="ch-num">
            {rangeText(r.start, r.end)}
          </Text>
        ) : (
          <Tooltip content="文件名未匹配 %Y-%m-%d_%H-%M-%S.mp4，无法解析起止时间">
            <Text type="secondary">无法解析</Text>
          </Tooltip>
        ),
    },
    {
      title: '操作',
      width: 150,
      align: 'right',
      render: (_, r) => {
        const url = recordingUrl(r.name)
        return (
          <Space size={4}>
            {url ? (
              <Button type="text" size="small" href={url} download={r.name}>
                下载
              </Button>
            ) : (
              <Tooltip content="mock 模式无真实文件可下载">
                <Button type="text" size="small" disabled>
                  下载
                </Button>
              </Tooltip>
            )}
            <Button
              type="text"
              size="small"
              status="danger"
              loading={deletingName === r.name}
              onClick={() => onDelete(r)}
            >
              删除
            </Button>
          </Space>
        )
      },
    },
  ]

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
        actions={
          <Button type="outline" icon={<IconRefresh />} onClick={reload} aria-label="刷新">
            刷新
          </Button>
        }
      />

      <Row gutter={12}>
        <Col xs={24} md={12} lg={13}>
          <Card size="small" title="存储水位" hoverable>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text className="ch-num" style={{ fontWeight: 600 }}>
                {formatBytes(totalSize)} / {maxGb} GB · {diskPct.toFixed(0)}%
              </Text>
            </div>
            <Progress
              percent={diskPct}
              showText={false}
              style={{ marginTop: 10 }}
              color={`rgb(var(${diskColor}))`}
              aria-label={`存储使用率 ${diskPct.toFixed(1)}%`}
            />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {retentionDays > 0 ? `retention ${retentionDays} 天 · ` : ''}到达 {maxGb} GB
                后自动清理最旧分段
              </Text>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={11}>
          <Card size="small" title="搜索分段" hoverable>
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
          </Card>
        </Col>
      </Row>

      <Table<RecordFile>
        rowKey="name"
        columns={columns}
        data={pageItemsView}
        border={{ wrapper: false, cell: false }}
        style={{ marginTop: 12 }}
        pagination={{
          total: filtered.length,
          pageSize: PAGE_SIZE,
          current: page,
          sizeCanChange: false,
          onChange: (p) => setPage(p),
          showTotal: true,
        }}
        noDataElement={
          <div style={{ padding: '32px 0' }}>
            <Text type="secondary">
              {keyword
                ? '没有匹配的录像文件，换个关键字试试。'
                : '开启录像后，每段录像会按 %Y-%m-%d_%H-%M-%S.mp4 命名并出现在这里。'}
            </Text>
            {keyword ? (
              <div style={{ marginTop: 12 }}>
                <Button type="outline" size="small" onClick={() => setKeyword('')}>
                  清空筛选
                </Button>
              </div>
            ) : null}
          </div>
        }
      />
    </>
  )
}
