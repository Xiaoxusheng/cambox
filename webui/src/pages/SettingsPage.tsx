/**
 * /settings —— CamBox Settings Workspace（v1.4.3 精修，任务书 §9~21）。
 * 左导航（200px，30px 项；SETTINGS 分组 + 底部独立 Danger Zone）+
 * 内容区 Section（标题/描述 + border 分隔的行），不再使用描边 Card 盒。
 * 行 = min-h 52px：左 Title(13)/Desc(11)，右 Control（32px 控件，宽度 field-sm/md/lg 常量）。
 * 业务逻辑零变化：POST /api/config 全量保存、通知测试、规则增删改、ROI 编辑、
 * 清空事件（batch-delete 分批）、内联「已保存 HH:mm:ss」状态全部保留。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Message,
  Modal,
  Progress,
  Select,
  Switch,
  TimePicker,
  Tooltip,
} from '@arco-design/web-react'
import { IconPlus, IconRefresh, IconSend, IconUndo } from '@arco-design/web-react/icon'
import { batchDeleteEvents, fetchConfig, fetchEvents, fetchStatus, saveConfig, testNotify } from '../api/endpoints'
import { errorText } from '../api/errors'
import type { CameraConfig, Config, NotifyConfig, ScheduleRule, Status } from '../api/types'
import { EmptyState, ErrorState, InitialLoading } from '../components/StateViews'
import { RoiEditorCard } from '../components/RoiEditorCard'
import { useAsync } from '../hooks/useAsync'
import { cx } from '../utils/cx'
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

/** 设置导航：SETTINGS 分组 + 底部独立 Danger Zone（任务书 §10/11/21） */
const TABS = [
  { key: 'camera', label: '摄像头' },
  { key: 'motion', label: '侦测' },
  { key: 'record', label: '录像' },
  { key: 'notify', label: '通知' },
  { key: 'schedule', label: '布防日程' },
  { key: 'selfcheck', label: '诊断' },
  { key: 'bot', label: 'Telegram' },
] as const

const DANGER_TAB = { key: 'danger', label: '危险操作' } as const

type TabKey = (typeof TABS)[number]['key'] | (typeof DANGER_TAB)['key']

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const num = (v: number | undefined, fallback: number) =>
  typeof v === 'number' && !Number.isNaN(v) ? v : fallback

/** 灵敏度预设：一键套用阈值 / 面积 / 冷却组合 */
const MOTION_PRESETS = [
  { key: 'loose', label: '宽松', threshold: 40, min_area: 1200, cooldown_sec: 15 },
  { key: 'standard', label: '标准', threshold: 22, min_area: 500, cooldown_sec: 8 },
  { key: 'sensitive', label: '灵敏', threshold: 12, min_area: 200, cooldown_sec: 5 },
] as const

/** 控件宽度常量（任务书 §16：small 160 / medium 220 / large 320，禁止散落 inline width） */
const FIELD_SM = 'w-full sm:w-40' // 160px
const FIELD_MD = 'w-full sm:w-[220px]' // 220px
const FIELD_LG = 'w-full sm:w-80' // 320px

/** 行式设置项（任务书 §14）：min-h 52px，左 Title+Desc，右 Control，行间 border-b 分隔 */
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
    <div className="flex min-h-[52px] flex-col items-stretch justify-start gap-1 border-b border-cam-border py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
      <div className="min-w-0">
        <div className="text-body text-cam-text-primary">{label}</div>
        {sub ? <div className="mt-0.5 text-caption leading-4 text-cam-text-tertiary">{sub}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Settings Section（任务书 §12/13）：标题+描述 → 分隔线 → 行列表。不是 Card。 */
function Section({
  title,
  sub,
  action,
  className,
  children,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cx('mb-7', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-section-title text-cam-text-primary">{title}</h3>
          {sub ? <p className="mt-1 text-caption text-cam-text-tertiary">{sub}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="mt-2 border-t border-cam-border pt-1">{children}</div>
    </section>
  )
}

/** 通知通道子组：通道头（名称 + 测试 + 启用开关）+ 字段行；不启用只显示说明（任务书 §17） */
function ChannelSection({
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
    <div className="border-b border-cam-border last:border-b-0">
      <div className="flex min-h-[52px] items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-body font-medium text-cam-text-primary">{title}</div>
          {hint ? <div className="mt-0.5 text-caption leading-4 text-cam-text-tertiary">{hint}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip content={enabled ? '向该通道发送一条测试消息' : '请先启用该通道'}>
            <Button size="mini" icon={<IconSend />} disabled={!enabled} loading={testing} onClick={onTest}>
              测试
            </Button>
          </Tooltip>
          <Switch checked={enabled} onChange={onToggle} aria-label={`启用${title}`} />
        </div>
      </div>
      {enabled ? (
        children
      ) : (
        <div className="pb-3 text-caption text-cam-text-tertiary">已停用：不接收该通道推送。</div>
      )}
    </div>
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
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
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
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
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

  /** 清空事件记录：分批拉取 id 再 batch-delete（现有契约端点），二次确认后执行 */
  function onClearEvents() {
    Modal.confirm({
      title: '清空全部事件记录？',
      content: '所有事件记录与关联快照文件将被永久删除，录像文件不受影响。操作不可恢复。',
      okText: '确认清空',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setClearing(true)
        try {
          let deleted = 0
          for (let i = 0; i < 200; i++) {
            const pageData = await fetchEvents({ limit: 500, offset: 0 })
            if (pageData.items.length === 0) break
            const res = await batchDeleteEvents(pageData.items.map((e) => e.id))
            deleted += res.deleted
            if (res.deleted === 0) break
          }
          Message.success(deleted > 0 ? `已清空 ${deleted} 条事件记录` : '没有可删除的事件')
        } catch (e) {
          Message.error(errorText(e))
        } finally {
          setClearing(false)
        }
      },
    })
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

  /** 日程规则的星期紧凑文案 */
  const dayText = (days: number[]) =>
    days.length === 0 ? '未选择' : days.length === 7 ? '每天' : days.map((d) => DAY_LABELS[d - 1] ?? d).join('、')

  return (
    <>
      {/* ---------- Page Header ---------- */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-page-title text-cam-text-primary">设置</h2>
          <p className="mt-1.5 text-body-secondary text-cam-text-tertiary">
            系统配置与运行行为 · 保存后写入 configs/config.yaml · 来源与解码改动需重启生效
          </p>
        </div>
        <Button type="outline" size="small" icon={<IconRefresh />} loading={loading} onClick={reload}>
          重新加载
        </Button>
      </div>

      {/* ---------- 左导航 + 内容 ---------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <nav
          className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-[68px] lg:flex-col lg:overflow-visible lg:pb-0"
          aria-label="设置分组"
        >
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => setTab(t.key)}
                className={cx(
                  'h-[30px] shrink-0 rounded-md px-2 text-left text-body transition-colors duration-100 ease-cam',
                  'lg:w-full',
                  active
                    ? 'bg-cam-selected font-medium text-cam-text-primary'
                    : 'text-cam-text-secondary hover:bg-cam-hover hover:text-cam-text-primary',
                )}
              >
                {t.label}
              </button>
            )
          })}
          {/* Danger Zone：与普通导航分隔（任务书 §21） */}
          <div className="hidden border-t border-cam-border pt-2 lg:block" aria-hidden="true" />
          <button
            type="button"
            aria-current={tab === DANGER_TAB.key ? 'true' : undefined}
            onClick={() => setTab(DANGER_TAB.key)}
            className={cx(
              'h-[30px] shrink-0 rounded-md px-2 text-left text-body transition-colors duration-100 ease-cam lg:w-full',
              tab === DANGER_TAB.key
                ? 'bg-cam-selected font-medium text-cam-danger'
                : 'text-cam-text-tertiary hover:bg-cam-hover hover:text-cam-danger',
            )}
          >
            {DANGER_TAB.label}
          </button>
        </nav>

        <div className="min-w-0">
          {/* ---------------- 摄像头 ---------------- */}
          {tab === 'camera' ? (
            <>
              <Section title="摄像头来源" sub="来源类型与流地址；保存后需重启服务生效">
                <Row label="名称" sub="显示在侧栏与事件元数据">
                  <Input className={FIELD_MD} value={cam.name} onChange={(v) => patchSection('camera', { name: v })} placeholder="如：前门摄像头" />
                </Row>
                <Row label="来源类型">
                  <Select
                    className={FIELD_MD}
                    value={cam.type}
                    onChange={(v) => patchSection('camera', { type: v as CameraConfig['type'] })}
                    options={CAMERA_TYPES}
                  />
                </Row>
                {cam.type === 'rtsp' ? (
                  <>
                    <Row label="主码流地址" sub="用于流复制录像">
                      <Input className={FIELD_LG} value={cam.rtsp} onChange={(v) => patchSection('camera', { rtsp: v })} placeholder="rtsp://user:pass@192.168.1.10:554/stream0" />
                    </Row>
                    <Row label="子码流地址" sub="用于解码 / 检测 / 预览；留空用主码流，分辨率不一致会统一缩放">
                      <Input className={FIELD_LG} value={cam.sub_rtsp} onChange={(v) => patchSection('camera', { sub_rtsp: v })} placeholder="rtsp://user:pass@192.168.1.10:554/stream1" />
                    </Row>
                  </>
                ) : null}
                {cam.type === 'url' ? (
                  <Row label="流地址" sub="HTTP-FLV / HLS / RTMP；直播地址带签名会过期，失效后更新">
                    <Input className={FIELD_LG} value={cam.url} onChange={(v) => patchSection('camera', { url: v })} placeholder="https://.../live.flv" allowClear />
                  </Row>
                ) : null}
                {cam.type === 'file' ? (
                  <Row label="视频文件路径">
                    <Input className={FIELD_LG} value={cam.file} onChange={(v) => patchSection('camera', { file: v })} />
                  </Row>
                ) : null}
                {cam.type === 'dshow' ? (
                  <Row label="DirectShow 设备名">
                    <Input className={FIELD_LG} value={cam.dshow_device} onChange={(v) => patchSection('camera', { dshow_device: v })} placeholder='video="USB Camera"' />
                  </Row>
                ) : null}
              </Section>

              <Section title="解码与预览" sub="预览质量与预览帧率热更新即时生效，其余需重启">
                <Row label="解码宽度" sub="解码输出统一缩放到该尺寸">
                  <InputNumber className={FIELD_SM} value={cam.width} min={64} max={7680} onChange={(v) => patchSection('camera', { width: num(v, cam.width) })} />
                </Row>
                <Row label="解码高度">
                  <InputNumber className={FIELD_SM} value={cam.height} min={64} max={4320} onChange={(v) => patchSection('camera', { height: num(v, cam.height) })} />
                </Row>
                <Row label="目标帧率">
                  <InputNumber className={FIELD_SM} value={cam.fps} min={1} max={120} onChange={(v) => patchSection('camera', { fps: num(v, cam.fps) })} />
                </Row>
                <Row label="断流重连间隔" sub="单位：秒">
                  <InputNumber className={FIELD_SM} value={cam.reconnect_delay_sec} min={1} max={60} onChange={(v) => patchSection('camera', { reconnect_delay_sec: num(v, cam.reconnect_delay_sec) })} />
                </Row>
                <Row label="预览质量" sub="MJPEG 预览与抓拍的 JPEG 画质 1–100">
                  <InputNumber className={FIELD_SM} value={cam.preview_quality} min={1} max={100} onChange={(v) => patchSection('camera', { preview_quality: num(v, cam.preview_quality) })} />
                </Row>
                <Row label="预览帧率" sub="MJPEG 推送帧率上限 1–30（不是录像帧率）">
                  <InputNumber className={FIELD_SM} value={cam.preview_fps} min={1} max={30} onChange={(v) => patchSection('camera', { preview_fps: num(v, cam.preview_fps) })} />
                </Row>
                <Row label="检测降采样宽度" sub="移动侦测的解码降采样宽度，越小越快、越省 CPU">
                  <InputNumber className={FIELD_SM} value={motion.downscale_width} min={64} max={1920} onChange={(v) => patchSection('motion', { downscale_width: num(v, motion.downscale_width) })} />
                </Row>
              </Section>
            </>
          ) : null}

          {/* ---------------- 侦测 ---------------- */}
          {tab === 'motion' ? (
            <>
              <Section title="移动侦测" sub="帧差法 · 解码子码流 · 实时计算">
                <Row label="移动侦测启用" sub="关闭后停止事件入库与推送">
                  <Switch checked={motion.enabled} onChange={(v) => patchSection('motion', { enabled: v })} aria-label="移动侦测启用" />
                </Row>
                <Row
                  label={
                    <>
                      触发阈值 <span className="cam-num">threshold</span>
                    </>
                  }
                  sub="帧差得分超过该值判定为移动"
                >
                  <InputNumber className={FIELD_SM} value={motion.threshold} min={1} max={255} onChange={(v) => patchSection('motion', { threshold: num(v, motion.threshold) })} />
                </Row>
                <Row
                  label={
                    <>
                      最小面积 <span className="cam-num">min_area (px)</span>
                    </>
                  }
                  sub="小于该面积的变动忽略"
                >
                  <InputNumber className={FIELD_SM} value={motion.min_area} min={1} suffix="px" onChange={(v) => patchSection('motion', { min_area: num(v, motion.min_area) })} />
                </Row>
                <Row
                  label={
                    <>
                      冷却时间 <span className="cam-num">cooldown_sec</span>
                    </>
                  }
                  sub="同一次事件的合并窗口"
                >
                  <InputNumber className={FIELD_SM} value={motion.cooldown_sec} min={1} max={3600} onChange={(v) => patchSection('motion', { cooldown_sec: num(v, motion.cooldown_sec) })} suffix="s" />
                </Row>
                <Row label="灵敏度预设" sub="一键套用阈值 / 面积 / 冷却组合">
                  <Select
                    className={FIELD_SM}
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
                    options={MOTION_PRESETS.map((p) => ({ label: p.label, value: p.key }))}
                    aria-label="灵敏度预设"
                  />
                </Row>
                <div className="py-2 text-caption leading-5 text-cam-text-tertiary">
                  提示：光照突变（开关灯）可能误报，调大三项参数可缓解。
                </div>
              </Section>

              <Section title="检测区域 ROI" sub="最多 8 个 · 归一化坐标 0~1 · 留空 = 全屏检测">
                <div className="py-3">
                  <RoiEditorCard rois={motion.rois} onChange={(rois) => patchSection('motion', { rois })} />
                </div>
              </Section>
            </>
          ) : null}

          {/* ---------------- 录像 ---------------- */}
          {tab === 'record' ? (
            <>
              <Section title="录像" sub="循环分段写入，按天数与容量自动清理">
                <Row label="启用录像" sub="受布防日程中的录像开关约束">
                  <Switch checked={record.enabled} onChange={(v) => patchSection('record', { enabled: v })} aria-label="启用录像" />
                </Row>
                <Row label="存储目录" sub="相对路径基于服务运行目录">
                  <Input className={FIELD_MD} value={record.dir} onChange={(v) => patchSection('record', { dir: v })} />
                </Row>
                <Row label="分段时长" sub={`当前约 ${(record.segment_seconds / 60).toFixed(1)} 分钟`}>
                  <InputNumber className={FIELD_SM} value={record.segment_seconds} min={10} max={86400} onChange={(v) => patchSection('record', { segment_seconds: num(v, record.segment_seconds) })} suffix="s" />
                </Row>
                <Row
                  label="编码 CRF"
                  sub="仅 synthetic / file / dshow 源生效（0–51，越小越清晰）；rtsp/url 为流复制，此值无效"
                >
                  <InputNumber className={FIELD_SM} value={record.encode_crf} min={0} max={51} onChange={(v) => patchSection('record', { encode_crf: num(v, record.encode_crf) })} />
                </Row>
              </Section>

              <Section title="循环清理" sub="按天数 + 按容量双阈值，快照同受天数管理">
                <Row label="保留天数" sub="超过后自动删除最旧录像">
                  <InputNumber className={FIELD_SM} value={record.retention_days} min={1} max={3650} onChange={(v) => patchSection('record', { retention_days: num(v, record.retention_days) })} suffix="天" />
                </Row>
                <Row label="磁盘上限" sub="到达后自动清理最旧分段">
                  <InputNumber className={FIELD_SM} value={record.max_disk_gb} min={1} onChange={(v) => patchSection('record', { max_disk_gb: num(v, record.max_disk_gb) })} suffix="GB" />
                </Row>
                <div className="py-3">
                  <div className="mb-2 text-body text-cam-text-primary">当前磁盘水位</div>
                  <Progress
                    percent={Math.min(
                      100,
                      (status.disk.recordings_bytes / Math.max(1, status.disk.max_gb * 1024 ** 3)) * 100,
                    )}
                    showText={false}
                  />
                  <div className="mt-2 text-caption text-cam-text-tertiary">
                    录像 <span className="cam-num">{formatBytes(status.disk.recordings_bytes)}</span> /{' '}
                    <span className="cam-num">{status.disk.max_gb} GB</span> · 快照{' '}
                    <span className="cam-num">{formatBytes(status.disk.snapshots_bytes)}</span>
                  </div>
                </div>
              </Section>
            </>
          ) : null}

          {/* ---------------- 通知 ---------------- */}
          {tab === 'notify' ? (
            <>
              <Section title="推送限流" sub="同一通道在该时间内最多推送一次">
                <Row label="限流间隔" sub="10–3600 秒">
                  <InputNumber className={FIELD_SM} value={notify.cooldown_sec} min={10} max={3600} onChange={(v) => patchSection('notify', { cooldown_sec: num(v, notify.cooldown_sec) })} suffix="s" />
                </Row>
              </Section>

              <Section title="推送通道" sub="按通道启用；「测试」向该通道发送一条测试消息">
                <ChannelSection
                  title="钉钉"
                  enabled={notify.dingtalk.enabled}
                  onToggle={(v) => patchNotify('dingtalk', { enabled: v })}
                  testing={testing === 'dingtalk'}
                  onTest={() => onTest('dingtalk')}
                >
                  <Row label="Webhook 地址">
                    <Input className={FIELD_LG} value={notify.dingtalk.webhook} onChange={(v) => patchNotify('dingtalk', { webhook: v })} placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
                  </Row>
                  <Row label="加签密钥" sub="可选，SEC 开头">
                    <Input className={FIELD_LG} value={notify.dingtalk.secret} onChange={(v) => patchNotify('dingtalk', { secret: v })} placeholder="SEC..." />
                  </Row>
                </ChannelSection>

                <ChannelSection
                  title="企业微信"
                  enabled={notify.wecom.enabled}
                  onToggle={(v) => patchNotify('wecom', { enabled: v })}
                  testing={testing === 'wecom'}
                  onTest={() => onTest('wecom')}
                >
                  <Row label="Webhook 地址">
                    <Input className={FIELD_LG} value={notify.wecom.webhook} onChange={(v) => patchNotify('wecom', { webhook: v })} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
                  </Row>
                </ChannelSection>

                <ChannelSection
                  title="Telegram"
                  enabled={notify.telegram.enabled}
                  onToggle={(v) => patchNotify('telegram', { enabled: v })}
                  testing={testing === 'telegram'}
                  onTest={() => onTest('telegram')}
                >
                  <Row label="Bot Token">
                    <Input className={FIELD_LG} value={notify.telegram.bot_token} onChange={(v) => patchNotify('telegram', { bot_token: v })} placeholder="123456:ABC-DEF..." />
                  </Row>
                  <Row label="Chat ID" sub="会话或群组 ID">
                    <Input className={FIELD_LG} value={notify.telegram.chat_id} onChange={(v) => patchNotify('telegram', { chat_id: v })} />
                  </Row>
                </ChannelSection>

                <ChannelSection
                  title="Bark"
                  enabled={notify.bark.enabled}
                  onToggle={(v) => patchNotify('bark', { enabled: v })}
                  testing={testing === 'bark'}
                  onTest={() => onTest('bark')}
                >
                  <Row label="服务地址">
                    <Input className={FIELD_LG} value={notify.bark.server} onChange={(v) => patchNotify('bark', { server: v })} placeholder="https://api.day.app" />
                  </Row>
                  <Row label="Device Key">
                    <Input className={FIELD_LG} value={notify.bark.device_key} onChange={(v) => patchNotify('bark', { device_key: v })} />
                  </Row>
                </ChannelSection>

                <ChannelSection
                  title="自定义 Webhook"
                  enabled={notify.webhook.enabled}
                  onToggle={(v) => patchNotify('webhook', { enabled: v })}
                  testing={testing === 'webhook'}
                  onTest={() => onTest('webhook')}
                >
                  <Row label="回调地址">
                    <Input className={FIELD_LG} value={notify.webhook.url} onChange={(v) => patchNotify('webhook', { url: v })} placeholder="https://example.com/hook" />
                  </Row>
                  <Row label="签名密钥" sub="可选">
                    <Input className={FIELD_LG} value={notify.webhook.secret} onChange={(v) => patchNotify('webhook', { secret: v })} />
                  </Row>
                </ChannelSection>
              </Section>
            </>
          ) : null}

          {/* ---------------- 布防日程 ---------------- */}
          {tab === 'schedule' ? (
            <Section
              title="布防日程"
              sub={`最多 16 条 · 当前 ${draft.schedules.rules.length} 条 · 空 = 全天按总开关执行；开始等于结束为全天，结束早于开始为跨零点`}
              action={
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
                draft.schedules.rules.map((r, i) => (
                  <div
                    key={i}
                    className="flex min-h-[52px] flex-wrap items-center gap-x-5 gap-y-1 border-b border-cam-border py-1.5 last:border-b-0"
                  >
                    <span className="min-w-[128px] text-body text-cam-text-primary">{dayText(r.days)}</span>
                    <span className="cam-num text-body-secondary text-cam-text-secondary">
                      {r.start} – {r.end}
                      {r.start === r.end ? '（全天）' : r.end < r.start ? '（跨零点）' : ''}
                    </span>
                    <span className="text-caption text-cam-text-tertiary">
                      侦测 {r.motion ? '开' : '关'} · 录像 {r.record ? '开' : '关'}
                    </span>
                    <span className="flex-1" />
                    <span className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => openRuleEditor(i)}
                        className="h-8 rounded-md px-2.5 text-body-secondary text-cam-text-secondary transition-colors duration-150 ease-cam hover:bg-cam-hover hover:text-cam-text-primary"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => setRules(draft.schedules.rules.filter((_, k) => k !== i))}
                        className="h-8 rounded-md px-2.5 text-body-secondary text-cam-text-tertiary transition-colors duration-150 ease-cam hover:bg-cam-danger/10 hover:text-cam-danger"
                      >
                        删除
                      </button>
                    </span>
                  </div>
                ))
              )}
            </Section>
          ) : null}

          {/* ---------------- 诊断（自检 + 日报） ---------------- */}
          {tab === 'selfcheck' ? (
            <>
              <Section title="画面自检" sub="周期比对帧，识别画面冻结与被遮挡（C3）">
                <Row label="启用画面自检">
                  <Switch checked={selfcheck.enabled} onChange={(v) => patchSection('selfcheck', { enabled: v })} aria-label="启用画面自检" />
                </Row>
                <Row label="自检周期" sub="60–3600 秒">
                  <InputNumber className={FIELD_SM} value={selfcheck.interval_sec} min={60} max={3600} onChange={(v) => patchSection('selfcheck', { interval_sec: num(v, selfcheck.interval_sec) })} suffix="s" />
                </Row>
                <Row label="冻结判定连续次数" sub="连续 N 次画面完全静止判为冻结">
                  <InputNumber className={FIELD_SM} value={selfcheck.frozen_checks} min={1} max={60} onChange={(v) => patchSection('selfcheck', { frozen_checks: num(v, selfcheck.frozen_checks) })} />
                </Row>
                <Row label="画面突变阈值" sub="1–255">
                  <InputNumber className={FIELD_SM} value={selfcheck.change_threshold} min={1} max={255} onChange={(v) => patchSection('selfcheck', { change_threshold: num(v, selfcheck.change_threshold) })} />
                </Row>
                <Row label="突变判定连续次数">
                  <InputNumber className={FIELD_SM} value={selfcheck.change_checks} min={1} max={60} onChange={(v) => patchSection('selfcheck', { change_checks: num(v, selfcheck.change_checks) })} />
                </Row>
                <Row label="当前状态">
                  <span className="inline-flex items-center gap-1.5 text-body-secondary">
                    <span
                      className={cx(
                        'h-1.5 w-1.5 rounded-full',
                        status.selfcheck.state === 'ok' ? 'bg-cam-success' : 'bg-cam-warning',
                      )}
                    />
                    {status.selfcheck.state === 'ok'
                      ? '正常'
                      : status.selfcheck.state === 'frozen'
                        ? '画面冻结'
                        : '画面异常'}
                  </span>
                </Row>
                <div className="cam-num py-2 text-caption text-cam-text-tertiary">
                  连续冻结 {status.selfcheck.consecutive_frozen} 次 · 连续突变 {status.selfcheck.consecutive_change} 次
                </div>
              </Section>

              <Section title="每日日报" sub="每天定时推送过去 24h 事件统计">
                <Row label="启用每日日报">
                  <Switch checked={digest.enabled} onChange={(v) => patchSection('digest', { enabled: v })} aria-label="启用每日日报" />
                </Row>
                <Row label="推送时刻" sub="当地时间">
                  <TimePicker className={FIELD_SM} value={digest.time} format="HH:mm" onChange={(v) => patchSection('digest', { time: v || digest.time })} />
                </Row>
              </Section>
            </>
          ) : null}

          {/* ---------------- Telegram ---------------- */}
          {tab === 'bot' ? (
            <>
              <Alert
                type="info"
                content={
                  <span>
                    Telegram 双向控制。命令：<code>/status</code> <code>/arm</code> <code>/disarm</code>{' '}
                    <code>/snap</code> <code>/events [n]</code> <code>/help</code>。Bot Token 变更后需重启服务才会重新建立轮询。
                  </span>
                }
                className="mb-7"
              />
              <Section title="Telegram Bot" sub="出于安全考虑，只有白名单内的用户才能通过 Bot 操作布防、抓拍与查询事件">
                <Row label="启用 Bot">
                  <Switch checked={bot.enabled} onChange={(v) => patchSection('bot', { enabled: v })} aria-label="启用 Bot" />
                </Row>
                <Row label="Bot Token" sub="可与通知中的 Telegram Token 相同">
                  <Input className={FIELD_LG} value={bot.bot_token} onChange={(v) => patchSection('bot', { bot_token: v })} placeholder="123456:ABC-DEF..." />
                </Row>
                <Row label="允许的用户 ID" sub="Telegram 数字用户 ID；留空则拒绝所有请求">
                  <Select
                    className={FIELD_LG}
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
                </Row>
              </Section>
            </>
          ) : null}

          {/* ---------------- Danger Zone（任务书 §21：轻色调，独立最后） ---------------- */}
          {tab === DANGER_TAB.key ? (
            <Section
              title="危险操作"
              sub="以下操作不可恢复，请谨慎执行"
              className="border border-cam-danger/15 bg-cam-danger/[0.03] px-4 pb-2"
            >
              <Row label="清空事件记录" sub={`删除全部事件及其关联快照文件（共 ${status.events_count} 条记录），录像文件不受影响。`}>
                <Button status="danger" type="outline" size="small" loading={clearing} onClick={onClearEvents}>
                  清空
                </Button>
              </Row>
            </Section>
          ) : null}
        </div>
      </div>

      {/* ---------- 保存条：实底 + border-top，无 blur（任务书 §20） ---------- */}
      <div className="sticky bottom-0 z-10 mt-6 -mx-5 flex h-[52px] flex-wrap items-center justify-between gap-3 border-t border-cam-border bg-cam-surface px-5 md:-mx-7 md:px-7 xl:-mx-10 xl:px-10 2xl:-mx-12 2xl:px-12">
        <span className={cx('text-body-secondary', dirty ? 'text-cam-warning' : 'text-cam-text-tertiary')}>
          {dirty
            ? `有 ${dirtyCount} 处未保存的修改${cameraDirty ? ' · 摄像头来源与解码参数需重启生效' : ''}`
            : savedAt
              ? `已保存 ${savedAt}`
              : '与服务器一致'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button type="outline" size="small" disabled={!dirty} icon={<IconUndo />} onClick={onReset}>
            撤销
          </Button>
          <Button type="primary" size="small" disabled={!dirty || saving} loading={saving} onClick={onSave}>
            保存全部
          </Button>
        </div>
      </div>

      <Modal
        visible={ruleModal}
        style={{ width: 'min(520px, calc(100vw - 32px))' }}
        title={ruleIndex >= 0 ? '编辑布防规则' : '添加布防规则'}
        okText="确定"
        cancelText="取消"
        onOk={commitRule}
        onCancel={() => setRuleModal(false)}
        autoFocus={false}
      >
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-2 text-body text-cam-text-primary">生效星期</div>
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
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <div className="mb-2 text-body text-cam-text-primary">开始时间</div>
              <TimePicker value={ruleDraft.start} format="HH:mm" onChange={(v) => setRuleDraft({ ...ruleDraft, start: v || ruleDraft.start })} />
            </div>
            <div>
              <div className="mb-2 text-body text-cam-text-primary">结束时间</div>
              <TimePicker value={ruleDraft.end} format="HH:mm" onChange={(v) => setRuleDraft({ ...ruleDraft, end: v || ruleDraft.end })} />
            </div>
          </div>
          <div className="text-caption text-cam-text-tertiary">结束与开始相同表示全天；早于开始表示跨零点。</div>
          <div className="flex gap-6">
            <label className="inline-flex items-center gap-2">
              <Switch checked={ruleDraft.motion} onChange={(v) => setRuleDraft({ ...ruleDraft, motion: v })} />
              允许移动侦测
            </label>
            <label className="inline-flex items-center gap-2">
              <Switch checked={ruleDraft.record} onChange={(v) => setRuleDraft({ ...ruleDraft, record: v })} />
              允许录像
            </label>
          </div>
        </div>
      </Modal>
    </>
  )
}
