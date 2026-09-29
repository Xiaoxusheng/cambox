/**
 * /settings 设置（v1.3 按 camhub-ui-4k/06 设计稿重做）
 * pill 标签页：摄像头 / 侦测 / 录像存储 / 通知 / 布防日程 / 自检与日报 / Bot。
 * 行式设置卡（label+描述 左，控件 右）；ROI 内联编辑进 draft，随「保存全部」提交。
 * 保存 = POST /api/config 全量（契约 §3.2）；camera 来源/解码改动提示需重启。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card as ArcoCard,
  Checkbox,
  Input,
  InputNumber,
  Message,
  Modal,
  Progress,
  Radio,
  Select,
  Switch,
  Tag,
  TimePicker,
  Tooltip,
} from '@arco-design/web-react'
import { IconPlus, IconRefresh, IconSend, IconUndo } from '@arco-design/web-react/icon'
import { fetchConfig, fetchStatus, saveConfig, testNotify } from '../api/endpoints'
import { errorText } from '../api/errors'
import type { CameraConfig, Config, NotifyConfig, ScheduleRule, Status } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { RoiEditorCard } from '../components/RoiEditorCard'
import { useAsync } from '../hooks/useAsync'
import { formatBytes } from '../utils/format'

type Loaded = [Config, Status]

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const CAMERA_TYPES = [
  { label: 'synthetic（模拟源）', value: 'synthetic' },
  { label: 'rtsp（网络摄像机）', value: 'rtsp' },
  { label: 'url（任意网络流）', value: 'url' },
  { label: 'file（本地文件）', value: 'file' },
  { label: 'dshow（Windows 采集设备）', value: 'dshow' },
]

const TABS = [
  { key: 'camera', label: '摄像头' },
  { key: 'motion', label: '侦测' },
  { key: 'record', label: '录像存储' },
  { key: 'notify', label: '通知' },
  { key: 'schedule', label: '布防日程' },
  { key: 'selfcheck', label: '自检与日报' },
  { key: 'bot', label: 'Bot' },
] as const

type TabKey = (typeof TABS)[number]['key']

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const num = (v: number | undefined, fallback: number) =>
  typeof v === 'number' && !Number.isNaN(v) ? v : fallback

/** 灵敏度预设（设计稿 06）：一键套用阈值 / 面积 / 冷却组合 */
const MOTION_PRESETS = [
  { key: 'loose', label: '宽松', threshold: 40, min_area: 1200, cooldown_sec: 15 },
  { key: 'standard', label: '标准', threshold: 22, min_area: 500, cooldown_sec: 8 },
  { key: 'sensitive', label: '灵敏', threshold: 12, min_area: 200, cooldown_sec: 5 },
] as const

/** 行式设置项：label+描述 左，控件 右 */
function Row({
  label,
  sub,
  children,
}: {
  label: React.ReactNode
  sub?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="ch-setrow">
      <div className="ch-setrow-main">
        <div className="ch-setrow-label">{label}</div>
        {sub ? <div className="ch-setrow-desc">{sub}</div> : null}
      </div>
      <div className="ch-setrow-control">{children}</div>
    </div>
  )
}

/** 设置卡片 */
function Card({
  title,
  sub,
  extra,
  children,
  bodyStyle,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  extra?: React.ReactNode
  children: React.ReactNode
  bodyStyle?: React.CSSProperties
}) {
  return (
    <ArcoCard
      size="small"
      title={
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {sub ? (
            <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-3)', marginTop: 2 }}>
              {sub}
            </div>
          ) : null}
        </div>
      }
      extra={extra}
      bodyStyle={bodyStyle}
    >
      {children}
    </ArcoCard>
  )
}

function ChannelCard({
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
    <Card
      title={title}
      sub={hint}
      extra={
        <>
          <Tooltip content={enabled ? '向该通道发送一条测试消息' : '请先启用该通道'}>
            <Button
              size="small"
              icon={<IconSend />}
              disabled={!enabled}
              loading={testing}
              onClick={onTest}
            >
              测试
            </Button>
          </Tooltip>
          <Switch checked={enabled} onChange={onToggle} aria-label={`启用${title}`} />
        </>
      }
    >
      {enabled ? children : <div className="ch-muted">已停用：不接收该通道推送。</div>}
    </Card>
  )
}

export function SettingsPage() {
  const { data, loading, error, reload } = useAsync<Loaded>(
    (signal) => Promise.all([fetchConfig(signal), fetchStatus(signal)]),
    [],
  )

  const [tab, setTab] = useState<TabKey>('motion')
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
  const dirtyCount = useMemo(() => {
    if (!draft || !baseline) return 0
    const keys: (keyof Config)[] = [
      'camera',
      'motion',
      'record',
      'notify',
      'schedules',
      'selfcheck',
      'digest',
      'bot',
    ]
    return keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(baseline[k])).length
  }, [draft, baseline])
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

  const setRules = (rules: ScheduleRule[]) => setDraft((d) => (d ? { ...d, schedules: { rules } } : d))

  async function onSave() {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await saveConfig(draft)
      setDraft(clone(saved))
      setBaseline(clone(saved))
      Message.success(
        cameraDirty
          ? '已保存。来源与解码参数需重启服务生效；预览质量 / 预览帧率已热更新'
          : '已保存，配置已热更新生效',
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
        Message.success(
          `测试消息已发送：${res.results.map((r) => r.channel).join('、') || '（无启用通道）'}`,
        )
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
        description="保存后写入 configs/config.yaml · 摄像头与端口改动需重启生效"
        actions={
          <Button type="outline" icon={<IconRefresh />} loading={loading} onClick={reload}>
            重新加载
          </Button>
        }
      />

      <Radio.Group
        type="button"
        value={tab}
        onChange={(v) => setTab(v as TabKey)}
        style={{ marginBottom: 14 }}
        aria-label="设置分组"
      >
        {TABS.map((t) => (
          <Radio key={t.key} value={t.key}>
            {t.label}
          </Radio>
        ))}
      </Radio.Group>

      {/* ---------------- 摄像头 ---------------- */}
      {tab === 'camera' ? (
        <div className="ch-settings-grid">
          <Card
            title="摄像头来源"
            sub="来源类型 / 流地址 / 解码尺寸保存后需重启服务生效"
            bodyStyle={{ paddingTop: 4 }}
          >
            <Row label="名称" sub="显示在面板顶部栏与事件副标题">
              <Input
                value={cam.name}
                onChange={(v) => patchSection('camera', { name: v })}
                style={{ width: 220 }}
                placeholder="如：前门摄像头"
              />
            </Row>
            <Row label="来源类型">
              <Select
                value={cam.type}
                onChange={(v) => patchSection('camera', { type: v as CameraConfig['type'] })}
                options={CAMERA_TYPES}
                style={{ width: 220 }}
              />
            </Row>
            {cam.type === 'rtsp' ? (
              <>
                <Row label="主码流地址" sub="用于流复制录像">
                  <Input
                    value={cam.rtsp}
                    onChange={(v) => patchSection('camera', { rtsp: v })}
                    style={{ width: 340 }}
                    placeholder="rtsp://user:pass@192.168.1.10:554/stream0"
                  />
                </Row>
                <Row
                  label="子码流地址"
                  sub="用于解码 / 检测 / 预览；留空用主码流，分辨率不一致会统一缩放"
                >
                  <Input
                    value={cam.sub_rtsp}
                    onChange={(v) => patchSection('camera', { sub_rtsp: v })}
                    style={{ width: 340 }}
                    placeholder="rtsp://user:pass@192.168.1.10:554/stream1"
                  />
                </Row>
              </>
            ) : null}
            {cam.type === 'url' ? (
              <Row label="流地址" sub="HTTP-FLV / HLS / RTMP；直播地址带签名会过期，失效后更新">
                <Input
                  value={cam.url}
                  onChange={(v) => patchSection('camera', { url: v })}
                  style={{ width: 340 }}
                  placeholder="https://.../live.flv"
                  allowClear
                />
              </Row>
            ) : null}
            {cam.type === 'file' ? (
              <Row label="视频文件路径">
                <Input
                  value={cam.file}
                  onChange={(v) => patchSection('camera', { file: v })}
                  style={{ width: 340 }}
                />
              </Row>
            ) : null}
            {cam.type === 'dshow' ? (
              <Row label="DirectShow 设备名">
                <Input
                  value={cam.dshow_device}
                  onChange={(v) => patchSection('camera', { dshow_device: v })}
                  style={{ width: 340 }}
                  placeholder='video="USB Camera"'
                />
              </Row>
            ) : null}
          </Card>

          <Card title="解码与预览" sub="预览质量与预览帧率热更新即时生效，其余需重启" bodyStyle={{ paddingTop: 4 }}>
            <Row label="解码宽度" sub="解码输出统一缩放到该尺寸">
              <InputNumber
                value={cam.width}
                min={64}
                max={7680}
                onChange={(v) => patchSection('camera', { width: num(v, cam.width) })}
              />
            </Row>
            <Row label="解码高度">
              <InputNumber
                value={cam.height}
                min={64}
                max={4320}
                onChange={(v) => patchSection('camera', { height: num(v, cam.height) })}
              />
            </Row>
            <Row label="目标帧率">
              <InputNumber
                value={cam.fps}
                min={1}
                max={120}
                onChange={(v) => patchSection('camera', { fps: num(v, cam.fps) })}
              />
            </Row>
            <Row label="断流重连间隔" sub="单位：秒">
              <InputNumber
                value={cam.reconnect_delay_sec}
                min={1}
                max={60}
                onChange={(v) =>
                  patchSection('camera', { reconnect_delay_sec: num(v, cam.reconnect_delay_sec) })
                }
              />
            </Row>
            <Row label="预览质量" sub="MJPEG 预览与抓拍的 JPEG 画质 1–100">
              <InputNumber
                value={cam.preview_quality}
                min={1}
                max={100}
                onChange={(v) =>
                  patchSection('camera', { preview_quality: num(v, cam.preview_quality) })
                }
              />
            </Row>
            <Row label="预览帧率" sub="MJPEG 推送帧率上限 1–30（不是录像帧率）">
              <InputNumber
                value={cam.preview_fps}
                min={1}
                max={30}
                onChange={(v) => patchSection('camera', { preview_fps: num(v, cam.preview_fps) })}
              />
            </Row>
            <Row label="检测降采样宽度" sub="移动侦测的解码降采样宽度，越小越快、越省 CPU">
              <InputNumber
                value={motion.downscale_width}
                min={64}
                max={1920}
                onChange={(v) =>
                  patchSection('motion', { downscale_width: num(v, motion.downscale_width) })
                }
              />
            </Row>
          </Card>
        </div>
      ) : null}

      {/* ---------------- 侦测 ---------------- */}
      {tab === 'motion' ? (
        <div className="ch-settings-grid">
          <Card title="移动侦测" sub="帧差法 · 解码子码流 · 实时计算" bodyStyle={{ paddingTop: 4 }}>
            <Row label="移动侦测启用" sub="关闭后停止事件入库与推送">
              <Switch
                checked={motion.enabled}
                onChange={(v) => patchSection('motion', { enabled: v })}
                aria-label="移动侦测启用"
              />
            </Row>
            <Row label={<>触发阈值 <span className="num">threshold</span></>} sub="帧差得分超过该值判定为移动">
              <InputNumber
                value={motion.threshold}
                min={1}
                max={255}
                onChange={(v) => patchSection('motion', { threshold: num(v, motion.threshold) })}
              />
            </Row>
            <Row
              label={
                <>
                  最小面积 <span className="num">min_area (px)</span>
                </>
              }
              sub="小于该面积的变动忽略"
            >
              <InputNumber
                value={motion.min_area}
                min={1}
                suffix="px"
                onChange={(v) => patchSection('motion', { min_area: num(v, motion.min_area) })}
              />
            </Row>
            <Row
              label={
                <>
                  冷却时间 <span className="num">cooldown_sec</span>
                </>
              }
              sub="同一次事件的合并窗口"
            >
              <InputNumber
                value={motion.cooldown_sec}
                min={1}
                max={3600}
                onChange={(v) => patchSection('motion', { cooldown_sec: num(v, motion.cooldown_sec) })}
                suffix="s"
              />
            </Row>
            <Row label="灵敏度预设" sub="一键套用阈值 / 面积 / 冷却组合">
              <Radio.Group
                type="button"
                size="small"
                value={MOTION_PRESETS.find(
                  (p) =>
                    motion.threshold === p.threshold &&
                    motion.min_area === p.min_area &&
                    motion.cooldown_sec === p.cooldown_sec,
                )?.key}
                onChange={(v) => {
                  const p = MOTION_PRESETS.find((x) => x.key === v)
                  if (p) {
                    patchSection('motion', {
                      threshold: p.threshold,
                      min_area: p.min_area,
                      cooldown_sec: p.cooldown_sec,
                    })
                  }
                }}
              >
                {MOTION_PRESETS.map((p) => (
                  <Radio key={p.key} value={p.key}>
                    {p.label}
                  </Radio>
                ))}
              </Radio.Group>
            </Row>
            <div className="ch-hint">提示：光照突变（开关灯）可能误报，调大三项参数可缓解。</div>
          </Card>

          <Card
            title="检测区域 ROI"
            sub="最多 8 个 · 归一化坐标 0~1 · 留空 = 全屏检测"
            bodyStyle={{ paddingTop: 4 }}
          >
            <div style={{ paddingTop: 12 }}>
              <RoiEditorCard rois={motion.rois} onChange={(rois) => patchSection('motion', { rois })} />
            </div>
          </Card>
        </div>
      ) : null}

      {/* ---------------- 录像存储 ---------------- */}
      {tab === 'record' ? (
        <div className="ch-settings-grid">
          <Card title="录像" sub="循环分段写入，按天数与容量自动清理" bodyStyle={{ paddingTop: 4 }}>
            <Row label="启用录像" sub="受布防日程中的录像开关约束">
              <Switch
                checked={record.enabled}
                onChange={(v) => patchSection('record', { enabled: v })}
                aria-label="启用录像"
              />
            </Row>
            <Row label="存储目录" sub="相对路径基于服务运行目录">
              <Input
                value={record.dir}
                onChange={(v) => patchSection('record', { dir: v })}
                style={{ width: 260 }}
              />
            </Row>
            <Row label="分段时长" sub={`当前约 ${(record.segment_seconds / 60).toFixed(1)} 分钟`}>
              <InputNumber
                value={record.segment_seconds}
                min={10}
                max={86400}
                onChange={(v) =>
                  patchSection('record', { segment_seconds: num(v, record.segment_seconds) })
                }
                suffix="s"
              />
            </Row>
            <Row label="编码 CRF" sub="仅 synthetic / file / dshow 源生效（0–51，越小越清晰）；rtsp/url 为流复制，此值无效">
              <InputNumber
                value={record.encode_crf}
                min={0}
                max={51}
                onChange={(v) => patchSection('record', { encode_crf: num(v, record.encode_crf) })}
              />
            </Row>
          </Card>

          <Card title="循环清理" sub="按天数 + 按容量双阈值，快照同受天数管理" bodyStyle={{ paddingTop: 4 }}>
            <Row label="保留天数" sub="超过后自动删除最旧录像">
              <InputNumber
                value={record.retention_days}
                min={1}
                max={3650}
                onChange={(v) =>
                  patchSection('record', { retention_days: num(v, record.retention_days) })
                }
                suffix="天"
              />
            </Row>
            <Row label="磁盘上限" sub="到达后自动清理最旧分段">
              <InputNumber
                value={record.max_disk_gb}
                min={1}
                onChange={(v) => patchSection('record', { max_disk_gb: num(v, record.max_disk_gb) })}
                suffix="GB"
              />
            </Row>
            <div style={{ marginTop: 16 }}>
              <div className="ch-setrow-label" style={{ marginBottom: 8 }}>
                当前磁盘水位
              </div>
              <Progress
                percent={Math.min(
                  100,
                  (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * 1024 ** 3)) * 100,
                )}
                showText={false}
              />
              <div className="ch-muted" style={{ marginTop: 8 }}>
                录像 <span className="num">{formatBytes(status.disk.recordings_bytes)}</span> /{' '}
                <span className="num">{status.disk.max_gb} GB</span> · 快照{' '}
                <span className="num">{formatBytes(status.disk.snapshots_bytes)}</span>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {/* ---------------- 通知 ---------------- */}
      {tab === 'notify' ? (
        <div className="ch-settings-grid">
          <Card title="推送限流" sub="同一通道在该时间内最多推送一次" bodyStyle={{ paddingTop: 4 }}>
            <Row label="限流间隔" sub="10–3600 秒">
              <InputNumber
                value={notify.cooldown_sec}
                min={10}
                max={3600}
                onChange={(v) => patchSection('notify', { cooldown_sec: num(v, notify.cooldown_sec) })}
                suffix="s"
              />
            </Row>
          </Card>

          <ChannelCard
            title="钉钉"
            enabled={notify.dingtalk.enabled}
            onToggle={(v) => patchNotify('dingtalk', { enabled: v })}
            testing={testing === 'dingtalk'}
            onTest={() => onTest('dingtalk')}
          >
            <Row label="Webhook 地址">
              <Input
                value={notify.dingtalk.webhook}
                onChange={(v) => patchNotify('dingtalk', { webhook: v })}
                style={{ width: 320 }}
                placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
              />
            </Row>
            <Row label="加签密钥" sub="可选，SEC 开头">
              <Input
                value={notify.dingtalk.secret}
                onChange={(v) => patchNotify('dingtalk', { secret: v })}
                style={{ width: 320 }}
                placeholder="SEC..."
              />
            </Row>
          </ChannelCard>

          <ChannelCard
            title="企业微信"
            enabled={notify.wecom.enabled}
            onToggle={(v) => patchNotify('wecom', { enabled: v })}
            testing={testing === 'wecom'}
            onTest={() => onTest('wecom')}
          >
            <Row label="Webhook 地址">
              <Input
                value={notify.wecom.webhook}
                onChange={(v) => patchNotify('wecom', { webhook: v })}
                style={{ width: 320 }}
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              />
            </Row>
          </ChannelCard>

          <ChannelCard
            title="Telegram"
            enabled={notify.telegram.enabled}
            onToggle={(v) => patchNotify('telegram', { enabled: v })}
            testing={testing === 'telegram'}
            onTest={() => onTest('telegram')}
          >
            <Row label="Bot Token">
              <Input
                value={notify.telegram.bot_token}
                onChange={(v) => patchNotify('telegram', { bot_token: v })}
                style={{ width: 320 }}
                placeholder="123456:ABC-DEF..."
              />
            </Row>
            <Row label="Chat ID" sub="会话或群组 ID">
              <Input
                value={notify.telegram.chat_id}
                onChange={(v) => patchNotify('telegram', { chat_id: v })}
                style={{ width: 320 }}
              />
            </Row>
          </ChannelCard>

          <ChannelCard
            title="Bark"
            enabled={notify.bark.enabled}
            onToggle={(v) => patchNotify('bark', { enabled: v })}
            testing={testing === 'bark'}
            onTest={() => onTest('bark')}
          >
            <Row label="服务地址">
              <Input
                value={notify.bark.server}
                onChange={(v) => patchNotify('bark', { server: v })}
                style={{ width: 320 }}
                placeholder="https://api.day.app"
              />
            </Row>
            <Row label="Device Key">
              <Input
                value={notify.bark.device_key}
                onChange={(v) => patchNotify('bark', { device_key: v })}
                style={{ width: 320 }}
              />
            </Row>
          </ChannelCard>

          <ChannelCard
            title="自定义 Webhook"
            enabled={notify.webhook.enabled}
            onToggle={(v) => patchNotify('webhook', { enabled: v })}
            testing={testing === 'webhook'}
            onTest={() => onTest('webhook')}
          >
            <Row label="回调地址">
              <Input
                value={notify.webhook.url}
                onChange={(v) => patchNotify('webhook', { url: v })}
                style={{ width: 320 }}
                placeholder="https://example.com/hook"
              />
            </Row>
            <Row label="签名密钥" sub="可选">
              <Input
                value={notify.webhook.secret}
                onChange={(v) => patchNotify('webhook', { secret: v })}
                style={{ width: 320 }}
              />
            </Row>
          </ChannelCard>
        </div>
      ) : null}

      {/* ---------------- 布防日程 ---------------- */}
      {tab === 'schedule' ? (
        <div style={{ maxWidth: 920 }}>
          <Alert
            type="info"
            content="日程为空时全天按「侦测 / 录像」总开关执行。开始时间等于结束时间表示全天；结束早于开始表示跨零点。"
            style={{ marginBottom: 14 }}
          />
          <Card
            title="日程规则"
            sub={`最多 16 条 · 当前 ${draft.schedules.rules.length} 条`}
            extra={
              <Button type="primary" size="small" icon={<IconPlus />} onClick={() => openRuleEditor(-1)}>
                添加规则
              </Button>
            }
          >
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {draft.schedules.rules.map((r, i) => (
                  <div className="ch-roi-item" key={i} style={{ color: 'var(--ch-text-1)', flexWrap: 'wrap', rowGap: 6 }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {(r.days.length === 0 ? [] : r.days).map((d) => (
                        <Tag key={d} size="small" className="ch-num">
                          {DAY_LABELS[d - 1] ?? d}
                        </Tag>
                      ))}
                      {r.days.length === 0 ? <span className="ch-muted">未选择星期</span> : null}
                    </span>
                    <span className="num">
                      {r.start} – {r.end}
                      {r.start === r.end ? '（全天）' : r.end < r.start ? '（跨零点）' : ''}
                    </span>
                    <Tag color={r.motion ? 'arcoblue' : 'gray'} size="small">
                      侦测 {r.motion ? '开' : '关'}
                    </Tag>
                    <Tag color={r.record ? 'green' : 'gray'} size="small">
                      录像 {r.record ? '开' : '关'}
                    </Tag>
                    <span style={{ flex: 1 }} />
                    <Button type="text" size="small" onClick={() => openRuleEditor(i)}>
                      编辑
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      status="danger"
                      onClick={() => setRules(draft.schedules.rules.filter((_, k) => k !== i))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {/* ---------------- 自检与日报 ---------------- */}
      {tab === 'selfcheck' ? (
        <div className="ch-settings-grid">
          <Card title="画面自检" sub="周期比对帧，识别画面冻结与被遮挡（C3）" bodyStyle={{ paddingTop: 4 }}>
            <Row label="启用画面自检">
              <Switch
                checked={selfcheck.enabled}
                onChange={(v) => patchSection('selfcheck', { enabled: v })}
                aria-label="启用画面自检"
              />
            </Row>
            <Row label="自检周期" sub="60–3600 秒">
              <InputNumber
                value={selfcheck.interval_sec}
                min={60}
                max={3600}
                onChange={(v) =>
                  patchSection('selfcheck', { interval_sec: num(v, selfcheck.interval_sec) })
                }
                suffix="s"
              />
            </Row>
            <Row label="冻结判定连续次数" sub="连续 N 次画面完全静止判为冻结">
              <InputNumber
                value={selfcheck.frozen_checks}
                min={1}
                max={60}
                onChange={(v) =>
                  patchSection('selfcheck', { frozen_checks: num(v, selfcheck.frozen_checks) })
                }
              />
            </Row>
            <Row label="画面突变阈值" sub="1–255">
              <InputNumber
                value={selfcheck.change_threshold}
                min={1}
                max={255}
                onChange={(v) =>
                  patchSection('selfcheck', { change_threshold: num(v, selfcheck.change_threshold) })
                }
              />
            </Row>
            <Row label="突变判定连续次数">
              <InputNumber
                value={selfcheck.change_checks}
                min={1}
                max={60}
                onChange={(v) =>
                  patchSection('selfcheck', { change_checks: num(v, selfcheck.change_checks) })
                }
              />
            </Row>
            <Row label="当前状态">
              <Tag color={status.selfcheck.state === 'ok' ? 'green' : 'orange'}>
                {status.selfcheck.state === 'ok'
                  ? '正常'
                  : status.selfcheck.state === 'frozen'
                    ? '画面冻结'
                    : '画面异常'}
              </Tag>
            </Row>
            <div className="ch-hint num">
              连续冻结 {status.selfcheck.consecutive_frozen} 次 · 连续突变{' '}
              {status.selfcheck.consecutive_change} 次
            </div>
          </Card>

          <Card title="每日日报" sub="每天定时推送过去 24h 事件统计" bodyStyle={{ paddingTop: 4 }}>
            <Row label="启用每日日报">
              <Switch
                checked={digest.enabled}
                onChange={(v) => patchSection('digest', { enabled: v })}
                aria-label="启用每日日报"
              />
            </Row>
            <Row label="推送时刻" sub="当地时间">
              <TimePicker
                value={digest.time}
                format="HH:mm"
                onChange={(v) => patchSection('digest', { time: v || digest.time })}
              />
            </Row>
          </Card>
        </div>
      ) : null}

      {/* ---------------- Bot ---------------- */}
      {tab === 'bot' ? (
        <div style={{ maxWidth: 760 }}>
          <Alert
            type="info"
            content={
              <span>
                Telegram 双向控制。命令：<code>/status</code> <code>/arm</code> <code>/disarm</code>{' '}
                <code>/snap</code> <code>/events [n]</code> <code>/help</code>。Bot Token
                变更后需重启服务才会重新建立轮询。
              </span>
            }
            style={{ marginBottom: 14 }}
          />
          <Card title="Telegram Bot" bodyStyle={{ paddingTop: 4 }}>
            <Row label="启用 Bot">
              <Switch
                checked={bot.enabled}
                onChange={(v) => patchSection('bot', { enabled: v })}
                aria-label="启用 Bot"
              />
            </Row>
            <Row label="Bot Token" sub="可与通知中的 Telegram Token 相同">
              <Input
                value={bot.bot_token}
                onChange={(v) => patchSection('bot', { bot_token: v })}
                style={{ width: 340 }}
                placeholder="123456:ABC-DEF..."
              />
            </Row>
            <Row label="允许的用户 ID" sub="Telegram 数字用户 ID；留空则拒绝所有请求">
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
                style={{ width: 340 }}
              />
            </Row>
            <div className="ch-hint">
              出于安全考虑，只有白名单内的用户才能通过 Bot 操作布防、抓拍与查询事件。
            </div>
          </Card>
        </div>
      ) : null}

      {/* 底部保存条 */}
      <div className="ch-savebar">
        <span className={`ch-savebar-text ${dirty ? 'dirty' : ''}`}>
          {dirty
            ? `有 ${dirtyCount} 处未保存的修改 · 保存后写入 configs/config.yaml${cameraDirty ? '（摄像头来源与解码参数需重启生效）' : ''}`
            : '与服务器一致'}
        </span>
        <Button type="outline" disabled={!dirty} icon={<IconUndo />} onClick={onReset}>
          撤销
        </Button>
        <Button type="primary" disabled={!dirty || saving} loading={saving} onClick={onSave}>
          保存全部
        </Button>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="ch-setrow-label" style={{ marginBottom: 8 }}>
              生效星期
            </div>
            <Checkbox.Group
              value={ruleDraft.days}
              onChange={(v) =>
                setRuleDraft({ ...ruleDraft, days: (v as number[]).slice().sort((a, b) => a - b) })
              }
            >
              {DAY_LABELS.map((label, i) => (
                <Checkbox key={i + 1} value={i + 1}>
                  {label}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="ch-setrow-label" style={{ marginBottom: 8 }}>
                开始时间
              </div>
              <TimePicker
                value={ruleDraft.start}
                format="HH:mm"
                onChange={(v) => setRuleDraft({ ...ruleDraft, start: v || ruleDraft.start })}
              />
            </div>
            <div>
              <div className="ch-setrow-label" style={{ marginBottom: 8 }}>
                结束时间
              </div>
              <TimePicker
                value={ruleDraft.end}
                format="HH:mm"
                onChange={(v) => setRuleDraft({ ...ruleDraft, end: v || ruleDraft.end })}
              />
            </div>
          </div>
          <div className="ch-muted">结束与开始相同表示全天；早于开始表示跨零点。</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={ruleDraft.motion} onChange={(v) => setRuleDraft({ ...ruleDraft, motion: v })} />
              允许移动侦测
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={ruleDraft.record} onChange={(v) => setRuleDraft({ ...ruleDraft, record: v })} />
              允许录像
            </label>
          </div>
        </div>
      </Modal>
    </>
  )
}
