/**
 * /settings 设置
 * Tabs：摄像头 / 侦测 / 录像存储 / 通知 / 布防日程 / 自检与日报 / Bot
 * 保存 = POST /api/config 全量（契约 §3.2）；camera 改动后提示"需重启生效"。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Message,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  TimePicker,
  Tooltip,
} from '@arco-design/web-react'
import {
  IconDelete,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSend,
  IconUndo,
} from '@arco-design/web-react/icon'
import { fetchConfig, fetchStatus, saveConfig, testNotify } from '../api/endpoints'
import { errorText } from '../api/errors'
import type { CameraConfig, Config, NotifyConfig, ScheduleRule, Status } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { StorageMeter } from '../components/StorageMeter'
import { useAsync } from '../hooks/useAsync'
import { formatBytes } from '../utils/format'

type Loaded = [Config, Status]

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const CAMERA_TYPES = [
  { label: 'synthetic（模拟源）', value: 'synthetic' },
  { label: 'rtsp（网络摄像机）', value: 'rtsp' },
  { label: 'file（本地文件）', value: 'file' },
  { label: 'dshow（Windows 采集设备）', value: 'dshow' },
]

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const num = (v: number | undefined, fallback: number) => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback)

/** 表单网格：窄屏自动单列 */
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 'var(--ch-space-md)',
}

function Field({ label, extra, children }: { label: string; extra?: string; children: React.ReactNode }) {
  return (
    <Form.Item label={label} extra={extra} style={{ marginBottom: 0 }}>
      {children}
    </Form.Item>
  )
}

function SwitchField({
  label,
  extra,
  checked,
  onChange,
}: {
  label: string
  extra?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Form.Item label={label} extra={extra} style={{ marginBottom: 0 }}>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
    </Form.Item>
  )
}

function ChannelBlock({
  title,
  hint,
  enabled,
  onToggle,
  onTest,
  testing,
  children,
}: {
  title: string
  hint?: string
  enabled: boolean
  onToggle: (v: boolean) => void
  onTest: () => void
  testing: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border-2)',
        borderRadius: 'var(--ch-radius-md)',
        padding: 'var(--ch-space-md)',
        marginBottom: 'var(--ch-space-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ch-space-sm)',
          marginBottom: enabled ? 'var(--ch-space-md)' : 0,
        }}
      >
        <Switch size="small" checked={enabled} onChange={onToggle} aria-label={`启用${title}`} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
          {title}
          {hint ? <span className="ch-muted" style={{ marginLeft: 8, fontWeight: 400 }}>{hint}</span> : null}
        </span>
        <Tooltip content={enabled ? '向该通道发送一条测试消息' : '请先启用该通道'}>
          <Button size="small" icon={<IconSend />} disabled={!enabled} loading={testing} onClick={onTest}>
            发送测试
          </Button>
        </Tooltip>
      </div>
      {enabled && children ? <div style={grid}>{children}</div> : null}
    </div>
  )
}

export function SettingsPage() {
  const { data, loading, error, reload } = useAsync<Loaded>(
    (signal) => Promise.all([fetchConfig(signal), fetchStatus(signal)]),
    [],
  )

  const [draft, setDraft] = useState<Config | null>(null)
  const [baseline, setBaseline] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [ruleModal, setRuleModal] = useState(false)
  const [ruleIndex, setRuleIndex] = useState(-1)
  const [ruleDraft, setRuleDraft] = useState<ScheduleRule>({
    days: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '22:00',
    motion: true,
    record: true,
  })

  useEffect(() => {
    if (data && !draft) {
      setDraft(clone(data[0]))
      setBaseline(clone(data[0]))
    }
  }, [data, draft])

  const status = data?.[1]

  const dirty = useMemo(
    () => !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  )
  const cameraDirty = useMemo(
    () => !!draft && !!baseline && JSON.stringify(draft.camera) !== JSON.stringify(baseline.camera),
    [draft, baseline],
  )

  // ---- 变更助手：全部走函数式更新，避免闭包过期 ----
  function patchSection<S extends keyof Config>(section: S, part: Partial<Config[S]>) {
    setDraft((d) => {
      if (!d) return d
      const current = d[section] as unknown as Record<string, unknown>
      const patch = part as unknown as Record<string, unknown>
      return { ...d, [section]: { ...current, ...patch } } as Config
    })
  }

  function patchNotify<K extends keyof NotifyConfig>(key: K, part: Partial<NotifyConfig[K]>) {
    setDraft((d) => {
      if (!d) return d
      const current = d.notify[key] as unknown as Record<string, unknown>
      const patch = part as unknown as Record<string, unknown>
      return { ...d, notify: { ...d.notify, [key]: { ...current, ...patch } } } as Config
    })
  }

  const setRules = (rules: ScheduleRule[]) =>
    setDraft((d) => (d ? { ...d, schedules: { rules } } : d))

  async function onSave() {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await saveConfig(draft)
      setDraft(clone(saved))
      setBaseline(clone(saved))
      Message.success(
        cameraDirty ? '已保存。摄像头配置需重启服务后生效。' : '已保存，配置已热更新生效',
      )
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  function onReset() {
    if (!baseline) return
    setDraft(clone(baseline))
    Message.info('已撤销未保存的修改')
  }

  async function onTest(channel: string) {
    setTesting(channel)
    try {
      const res = await testNotify(channel)
      const failed = res.results.filter((r) => !r.ok)
      if (failed.length === 0) {
        Message.success(`测试消息已发送：${res.results.map((r) => r.channel).join('、') || '（无启用通道）'}`)
      } else {
        Message.error(failed.map((r) => `${r.channel}：${r.error || '发送失败'}`).join('；'))
      }
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setTesting(null)
    }
  }

  function openRuleEditor(index: number) {
    setRuleIndex(index)
    setRuleDraft(
      index >= 0 && draft
        ? clone(draft.schedules.rules[index])
        : { days: [1, 2, 3, 4, 5], start: '08:00', end: '22:00', motion: true, record: true },
    )
    setRuleModal(true)
  }

  function commitRule() {
    if (!draft) return
    if (ruleDraft.days.length === 0) {
      Message.warning('请至少选择一个星期')
      return
    }
    if (!HHMM.test(ruleDraft.start) || !HHMM.test(ruleDraft.end)) {
      Message.warning('时间格式应为 HH:MM')
      return
    }
    if (draft.schedules.rules.length >= 16 && ruleIndex < 0) {
      Message.warning('最多 16 条布防日程')
      return
    }
    const next = draft.schedules.rules.slice()
    if (ruleIndex >= 0) next[ruleIndex] = ruleDraft
    else next.push(ruleDraft)
    setRules(next)
    setRuleModal(false)
  }

  if (loading && !data) return <InitialLoading rows={5} />
  if (error && !data) return <ErrorState title="配置加载失败" error={error} onRetry={reload} />
  if (!draft || !status) return null

  const cam = draft.camera
  const motion = draft.motion
  const record = draft.record
  const notify = draft.notify
  const selfcheck = draft.selfcheck
  const digest = draft.digest
  const bot = draft.bot

  return (
    <>
      <PageHeader
        title="设置"
        description="所有修改在点击「保存配置」后提交；除摄像头与服务器参数外均立即热更新生效。"
        actions={
          <Button icon={<IconRefresh />} loading={loading} onClick={reload}>
            重新加载
          </Button>
        }
      />

      <Panel bodyStyle={{ paddingTop: 'var(--ch-space-sm)' }}>
        <Tabs defaultActiveTab="camera" type="line">
          {/* ---------------- 摄像头 ---------------- */}
          <Tabs.TabPane key="camera" title="摄像头">
            <div className="ch-note" style={{ marginBottom: 'var(--ch-space-md)' }}>
              摄像头参数在保存后<strong>需重启服务</strong>才会生效；其余配置热更新即可生效。
            </div>
            <Form layout="vertical">
              <div style={grid}>
                <Field label="名称">
                  <Input
                    value={cam.name}
                    onChange={(v) => patchSection('camera', { name: v })}
                    placeholder="显示在面板标题上的相机名"
                  />
                </Field>
                <Field label="来源类型">
                  <Select
                    value={cam.type}
                    onChange={(v) => patchSection('camera', { type: v as CameraConfig['type'] })}
                    options={CAMERA_TYPES}
                  />
                </Field>

                {cam.type === 'rtsp' ? (
                  <>
                    <Field label="主码流地址（录像用）">
                      <Input
                        value={cam.rtsp}
                        onChange={(v) => patchSection('camera', { rtsp: v })}
                        placeholder="rtsp://user:pass@192.168.1.10:554/stream1"
                      />
                    </Field>
                    <Field label="子码流地址（预览 + 检测解码）" extra="留空则使用主码流；子码流分辨率不一致时由服务端统一缩放到下方尺寸">
                      <Input
                        value={cam.sub_rtsp}
                        onChange={(v) => patchSection('camera', { sub_rtsp: v })}
                        placeholder="rtsp://user:pass@192.168.1.10:554/stream2"
                      />
                    </Field>
                  </>
                ) : null}

                {cam.type === 'file' ? (
                  <Field label="视频文件路径">
                    <Input value={cam.file} onChange={(v) => patchSection('camera', { file: v })} />
                  </Field>
                ) : null}

                {cam.type === 'dshow' ? (
                  <Field label="DirectShow 设备名">
                    <Input
                      value={cam.dshow_device}
                      onChange={(v) => patchSection('camera', { dshow_device: v })}
                      placeholder='video="USB Camera"'
                    />
                  </Field>
                ) : null}

                <Field label="解码宽度" extra="解码输出会被强制缩放到该尺寸">
                  <InputNumber
                    value={cam.width}
                    min={64}
                    max={7680}
                    onChange={(v) => patchSection('camera', { width: num(v, cam.width) })}
                  />
                </Field>
                <Field label="解码高度">
                  <InputNumber
                    value={cam.height}
                    min={64}
                    max={4320}
                    onChange={(v) => patchSection('camera', { height: num(v, cam.height) })}
                  />
                </Field>
                <Field label="目标帧率">
                  <InputNumber
                    value={cam.fps}
                    min={1}
                    max={120}
                    onChange={(v) => patchSection('camera', { fps: num(v, cam.fps) })}
                  />
                </Field>
                <Field label="断流重连间隔（秒）">
                  <InputNumber
                    value={cam.reconnect_delay_sec}
                    min={1}
                    max={60}
                    onChange={(v) =>
                      patchSection('camera', { reconnect_delay_sec: num(v, cam.reconnect_delay_sec) })
                    }
                  />
                </Field>
              </div>
            </Form>
          </Tabs.TabPane>

          {/* ---------------- 侦测 ---------------- */}
          <Tabs.TabPane key="motion" title="侦测">
            <Form layout="vertical">
              <div style={grid}>
                <SwitchField
                  label="启用移动侦测"
                  extra="关闭后不再产生侦测事件（受布防日程约束）"
                  checked={motion.enabled}
                  onChange={(v) => patchSection('motion', { enabled: v })}
                />
                <Field label="像素差阈值（1–255）" extra="越小越敏感">
                  <InputNumber
                    value={motion.threshold}
                    min={1}
                    max={255}
                    onChange={(v) => patchSection('motion', { threshold: num(v, motion.threshold) })}
                  />
                </Field>
                <Field label="最小变化面积（像素）">
                  <InputNumber
                    value={motion.min_area}
                    min={1}
                    onChange={(v) => patchSection('motion', { min_area: num(v, motion.min_area) })}
                  />
                </Field>
                <Field label="事件冷却（秒）" extra="同一通道在该时间内只记录一次">
                  <InputNumber
                    value={motion.cooldown_sec}
                    min={1}
                    max={3600}
                    onChange={(v) =>
                      patchSection('motion', { cooldown_sec: num(v, motion.cooldown_sec) })
                    }
                  />
                </Field>
                <Field label="检测降采样宽度" extra="越小越快、越省 CPU">
                  <InputNumber
                    value={motion.downscale_width}
                    min={64}
                    max={1920}
                    onChange={(v) =>
                      patchSection('motion', { downscale_width: num(v, motion.downscale_width) })
                    }
                  />
                </Field>
              </div>

              <div style={{ marginTop: 'var(--ch-space-lg)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  检测区域（ROI）
                  <span className="ch-muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                    {motion.rois.length === 0 ? '未设置，按全屏检测' : `已设置 ${motion.rois.length} 个`}
                  </span>
                </div>
                {motion.rois.length === 0 ? (
                  <div className="ch-muted">
                    当前统计全部画面内的变化像素。
                  </div>
                ) : (
                  <Space wrap size={8}>
                    {motion.rois.map((r, i) => (
                      <Tag key={i} className="num" size="small">
                        #{i + 1} x{r[0].toFixed(2)} y{r[1].toFixed(2)} w{r[2].toFixed(2)} h{r[3].toFixed(2)}
                      </Tag>
                    ))}
                  </Space>
                )}
                <div className="ch-muted" style={{ marginTop: 8 }}>
                  在「实时」页的截图上拖拽画框即可编辑检测区域。
                </div>
              </div>
            </Form>
          </Tabs.TabPane>

          {/* ---------------- 录像存储 ---------------- */}
          <Tabs.TabPane key="record" title="录像存储">
            <Form layout="vertical">
              <div style={grid}>
                <SwitchField
                  label="启用录像"
                  extra="受布防日程中的 record 开关约束"
                  checked={record.enabled}
                  onChange={(v) => patchSection('record', { enabled: v })}
                />
                <Field label="存储目录" extra="相对路径基于服务运行目录">
                  <Input value={record.dir} onChange={(v) => patchSection('record', { dir: v })} />
                </Field>
                <Field label="分段时长（秒）" extra={`约 ${(record.segment_seconds / 60).toFixed(1)} 分钟`}>
                  <InputNumber
                    value={record.segment_seconds}
                    min={10}
                    max={86400}
                    onChange={(v) =>
                      patchSection('record', { segment_seconds: num(v, record.segment_seconds) })
                    }
                  />
                </Field>
                <Field label="保留天数">
                  <InputNumber
                    value={record.retention_days}
                    min={1}
                    max={3650}
                    onChange={(v) =>
                      patchSection('record', { retention_days: num(v, record.retention_days) })
                    }
                  />
                </Field>
                <Field label="磁盘上限（GB）" extra="超出后自动清理最早录像">
                  <InputNumber
                    value={record.max_disk_gb}
                    min={1}
                    onChange={(v) => patchSection('record', { max_disk_gb: num(v, record.max_disk_gb) })}
                  />
                </Field>
              </div>

              <div style={{ marginTop: 'var(--ch-space-lg)', maxWidth: 480 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>当前磁盘水位</div>
                <StorageMeter usedBytes={status.disk.recordings_bytes} maxGb={status.disk.max_gb} />
                <div className="ch-muted" style={{ marginTop: 8 }}>
                  快照占用 <span className="num">{formatBytes(status.disk.snapshots_bytes)}</span>；修改上限需保存后生效。
                </div>
              </div>
            </Form>
          </Tabs.TabPane>

          {/* ---------------- 通知 ---------------- */}
          <Tabs.TabPane key="notify" title="通知">
            <Form layout="vertical">
              <div style={{ maxWidth: 280 }}>
                <Field label="推送限流（秒）" extra="同一通道在该时间内最多推送一次（10–3600）">
                  <InputNumber
                    value={notify.cooldown_sec}
                    min={10}
                    max={3600}
                    onChange={(v) => patchSection('notify', { cooldown_sec: num(v, notify.cooldown_sec) })}
                  />
                </Field>
              </div>

              <div style={{ marginTop: 'var(--ch-space-md)' }}>
                <ChannelBlock
                  title="钉钉"
                  enabled={notify.dingtalk.enabled}
                  onToggle={(v) => patchNotify('dingtalk', { enabled: v })}
                  testing={testing === 'dingtalk'}
                  onTest={() => onTest('dingtalk')}
                >
                  <Field label="Webhook 地址">
                    <Input
                      value={notify.dingtalk.webhook}
                      onChange={(v) => patchNotify('dingtalk', { webhook: v })}
                      placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                    />
                  </Field>
                  <Field label="加签密钥（可选）">
                    <Input
                      value={notify.dingtalk.secret}
                      onChange={(v) => patchNotify('dingtalk', { secret: v })}
                      placeholder="SEC..."
                    />
                  </Field>
                </ChannelBlock>

                <ChannelBlock
                  title="企业微信"
                  enabled={notify.wecom.enabled}
                  onToggle={(v) => patchNotify('wecom', { enabled: v })}
                  testing={testing === 'wecom'}
                  onTest={() => onTest('wecom')}
                >
                  <Field label="Webhook 地址">
                    <Input
                      value={notify.wecom.webhook}
                      onChange={(v) => patchNotify('wecom', { webhook: v })}
                      placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                    />
                  </Field>
                </ChannelBlock>

                <ChannelBlock
                  title="Telegram"
                  enabled={notify.telegram.enabled}
                  onToggle={(v) => patchNotify('telegram', { enabled: v })}
                  testing={testing === 'telegram'}
                  onTest={() => onTest('telegram')}
                >
                  <Field label="Bot Token">
                    <Input
                      value={notify.telegram.bot_token}
                      onChange={(v) => patchNotify('telegram', { bot_token: v })}
                      placeholder="123456:ABC-DEF..."
                    />
                  </Field>
                  <Field label="Chat ID">
                    <Input
                      value={notify.telegram.chat_id}
                      onChange={(v) => patchNotify('telegram', { chat_id: v })}
                      placeholder="会话或群组 ID"
                    />
                  </Field>
                </ChannelBlock>

                <ChannelBlock
                  title="Bark"
                  enabled={notify.bark.enabled}
                  onToggle={(v) => patchNotify('bark', { enabled: v })}
                  testing={testing === 'bark'}
                  onTest={() => onTest('bark')}
                >
                  <Field label="服务地址">
                    <Input
                      value={notify.bark.server}
                      onChange={(v) => patchNotify('bark', { server: v })}
                      placeholder="https://api.day.app"
                    />
                  </Field>
                  <Field label="Device Key">
                    <Input
                      value={notify.bark.device_key}
                      onChange={(v) => patchNotify('bark', { device_key: v })}
                    />
                  </Field>
                </ChannelBlock>

                <ChannelBlock
                  title="自定义 Webhook"
                  enabled={notify.webhook.enabled}
                  onToggle={(v) => patchNotify('webhook', { enabled: v })}
                  testing={testing === 'webhook'}
                  onTest={() => onTest('webhook')}
                >
                  <Field label="回调地址">
                    <Input
                      value={notify.webhook.url}
                      onChange={(v) => patchNotify('webhook', { url: v })}
                      placeholder="https://example.com/hook"
                    />
                  </Field>
                  <Field label="签名密钥（可选）">
                    <Input
                      value={notify.webhook.secret}
                      onChange={(v) => patchNotify('webhook', { secret: v })}
                    />
                  </Field>
                </ChannelBlock>
              </div>
              <div className="ch-muted">
                未启用的通道不会收到推送；「发送测试」会立即向已启用通道发送一条测试消息。
              </div>
            </Form>
          </Tabs.TabPane>

          {/* ---------------- 布防日程 ---------------- */}
          <Tabs.TabPane key="schedule" title="布防日程">
            <div className="ch-note info" style={{ marginBottom: 'var(--ch-space-md)' }}>
              日程为空时全天按「侦测 / 录像」总开关执行。开始时间等于结束时间表示全天；结束早于开始表示跨零点。
            </div>
            <div style={{ marginBottom: 'var(--ch-space-md)' }}>
              <Button type="primary" icon={<IconPlus />} onClick={() => openRuleEditor(-1)}>
                添加规则
              </Button>
              <span className="ch-muted" style={{ marginLeft: 12 }}>
                {draft.schedules.rules.length}/16 条
              </span>
            </div>
            {draft.schedules.rules.length === 0 ? (
              <EmptyState
                title="暂无布防日程"
                description="添加规则后，仅在指定星期与时段内记录事件、执行录像。"
                action={
                  <Button size="small" onClick={() => openRuleEditor(-1)}>
                    添加第一条规则
                  </Button>
                }
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ch-space-sm)' }}>
                {draft.schedules.rules.map((r, i) => (
                  <div
                    className="ch-roi-item"
                    key={i}
                    style={{ gap: 'var(--ch-space-md)', flexWrap: 'wrap' }}
                  >
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 176 }}>
                      {r.days.length === 0 ? (
                        <span className="ch-muted">未选择星期</span>
                      ) : (
                        r.days.map((d) => (
                          <Tag key={d} size="small">
                            {DAY_LABELS[d - 1] ?? d}
                          </Tag>
                        ))
                      )}
                    </span>
                    <span className="num" style={{ minWidth: 148 }}>
                      {r.start} – {r.end}
                      {r.start === r.end ? '（全天）' : r.end < r.start ? '（跨零点）' : ''}
                    </span>
                    <Tag color={r.motion ? 'arcoblue' : undefined} size="small">
                      侦测 {r.motion ? '开' : '关'}
                    </Tag>
                    <Tag color={r.record ? 'green' : undefined} size="small">
                      录像 {r.record ? '开' : '关'}
                    </Tag>
                    <span style={{ flex: 1 }} />
                    <Button size="mini" type="text" icon={<IconEdit />} onClick={() => openRuleEditor(i)}>
                      编辑
                    </Button>
                    <Button
                      size="mini"
                      type="text"
                      status="danger"
                      icon={<IconDelete />}
                      onClick={() => setRules(draft.schedules.rules.filter((_, k) => k !== i))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Tabs.TabPane>

          {/* ---------------- 自检与日报 ---------------- */}
          <Tabs.TabPane key="selfcheck" title="自检与日报">
            <Form layout="vertical">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>画面自检</div>
              <div style={grid}>
                <SwitchField
                  label="启用画面自检"
                  extra="周期性检测画面冻结与被遮挡"
                  checked={selfcheck.enabled}
                  onChange={(v) => patchSection('selfcheck', { enabled: v })}
                />
                <Field label="自检周期（秒）" extra="60–3600">
                  <InputNumber
                    value={selfcheck.interval_sec}
                    min={60}
                    max={3600}
                    onChange={(v) =>
                      patchSection('selfcheck', { interval_sec: num(v, selfcheck.interval_sec) })
                    }
                  />
                </Field>
                <Field label="冻结判定连续次数" extra="连续 N 次画面完全静止判为冻结">
                  <InputNumber
                    value={selfcheck.frozen_checks}
                    min={1}
                    max={60}
                    onChange={(v) =>
                      patchSection('selfcheck', { frozen_checks: num(v, selfcheck.frozen_checks) })
                    }
                  />
                </Field>
                <Field label="画面突变阈值（1–255）">
                  <InputNumber
                    value={selfcheck.change_threshold}
                    min={1}
                    max={255}
                    onChange={(v) =>
                      patchSection('selfcheck', {
                        change_threshold: num(v, selfcheck.change_threshold),
                      })
                    }
                  />
                </Field>
                <Field label="突变判定连续次数">
                  <InputNumber
                    value={selfcheck.change_checks}
                    min={1}
                    max={60}
                    onChange={(v) =>
                      patchSection('selfcheck', { change_checks: num(v, selfcheck.change_checks) })
                    }
                  />
                </Field>
              </div>

              <div style={{ marginTop: 'var(--ch-space-lg)', maxWidth: 480 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>当前自检状态</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-2)', lineHeight: '22px' }}>
                  <div>
                    状态：
                    <Tag
                      size="small"
                      color={status.selfcheck.state === 'ok' ? 'green' : 'orange'}
                    >
                      {status.selfcheck.state === 'ok'
                        ? '正常'
                        : status.selfcheck.state === 'frozen'
                          ? '画面冻结'
                          : '画面异常'}
                    </Tag>
                  </div>
                  <div className="num">
                    连续冻结 {status.selfcheck.consecutive_frozen} 次 · 连续突变{' '}
                    {status.selfcheck.consecutive_change} 次
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, margin: '24px 0 12px' }}>每日日报</div>
              <div style={grid}>
                <SwitchField
                  label="启用每日日报"
                  extra="每天统计过去 24 小时事件并推送"
                  checked={digest.enabled}
                  onChange={(v) => patchSection('digest', { enabled: v })}
                />
                <Field label="推送时刻（当地时间）">
                  <TimePicker
                    value={digest.time}
                    format="HH:mm"
                    onChange={(v) => patchSection('digest', { time: v || digest.time })}
                  />
                </Field>
              </div>
            </Form>
          </Tabs.TabPane>

          {/* ---------------- Bot ---------------- */}
          <Tabs.TabPane key="bot" title="Bot">
            <Form layout="vertical">
              <div className="ch-note info" style={{ marginBottom: 'var(--ch-space-md)' }}>
                Telegram 双向控制。命令：<code>/status</code> <code>/arm</code> <code>/disarm</code>{' '}
                <code>/snap</code> <code>/events [n]</code> <code>/help</code>。
                Bot Token 变更后需重启服务才会重新建立轮询。
              </div>
              <div style={grid}>
                <SwitchField
                  label="启用 Bot"
                  checked={bot.enabled}
                  onChange={(v) => patchSection('bot', { enabled: v })}
                />
                <Field label="Bot Token" extra="可与通知中的 Telegram Token 相同">
                  <Input
                    value={bot.bot_token}
                    onChange={(v) => patchSection('bot', { bot_token: v })}
                    placeholder="123456:ABC-DEF..."
                  />
                </Field>
                <Field label="允许的用户 ID" extra="Telegram 数字用户 ID；留空则拒绝所有请求">
                  <Select
                    mode="multiple"
                    allowCreate
                    value={bot.allowed_users}
                    onChange={(v) =>
                      patchSection('bot', {
                        allowed_users: (v as string[]).filter((s) => /^\d+$/.test(s)),
                      })
                    }
                    placeholder="输入数字 ID 后回车"
                    allowClear
                  />
                </Field>
              </div>
              <div className="ch-muted" style={{ marginTop: 8 }}>
                出于安全考虑，只有白名单内的用户才能通过 Bot 操作布防、抓拍与查询事件。
              </div>
            </Form>
          </Tabs.TabPane>
        </Tabs>
      </Panel>

      <div className="ch-savebar">
        <Button type="primary" icon={<IconSave />} loading={saving} disabled={!dirty} onClick={onSave}>
          保存配置
        </Button>
        <Button icon={<IconUndo />} disabled={!dirty} onClick={onReset}>
          撤销修改
        </Button>
        <span className="ch-muted" style={{ flex: 1 }}>
          {dirty ? '有未保存的修改' : '与服务器一致'}
          {cameraDirty ? ' · 摄像头配置保存后需重启服务生效' : ''}
        </span>
      </div>

      <Modal
        visible={ruleModal}
        title={ruleIndex >= 0 ? '编辑布防规则' : '添加布防规则'}
        okText="确定"
        cancelText="取消"
        onOk={commitRule}
        onCancel={() => setRuleModal(false)}
        autoFocus={false}
      >
        <Form layout="vertical">
          <Form.Item label="生效星期">
            <Checkbox.Group
              value={ruleDraft.days}
              onChange={(v) => setRuleDraft({ ...ruleDraft, days: (v as number[]).slice().sort((a, b) => a - b) })}
            >
              {DAY_LABELS.map((label, i) => (
                <Checkbox key={i + 1} value={i + 1}>
                  {label}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
          <div style={grid}>
            <Form.Item label="开始时间">
              <TimePicker
                value={ruleDraft.start}
                format="HH:mm"
                onChange={(v) => setRuleDraft({ ...ruleDraft, start: v || ruleDraft.start })}
              />
            </Form.Item>
            <Form.Item label="结束时间" extra="与开始相同表示全天；早于开始表示跨零点">
              <TimePicker
                value={ruleDraft.end}
                format="HH:mm"
                onChange={(v) => setRuleDraft({ ...ruleDraft, end: v || ruleDraft.end })}
              />
            </Form.Item>
          </div>
          <div style={grid}>
            <Form.Item label="允许移动侦测">
              <Switch
                checked={ruleDraft.motion}
                onChange={(v) => setRuleDraft({ ...ruleDraft, motion: v })}
              />
            </Form.Item>
            <Form.Item label="允许录像">
              <Switch
                checked={ruleDraft.record}
                onChange={(v) => setRuleDraft({ ...ruleDraft, record: v })}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  )
}
