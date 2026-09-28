/**
 * /live 实时
 * 左：MJPEG 实时画面 + fps + 抓拍；右：布防开关 + ROI 检测区域编辑器。
 * ROI 保存走 POST /api/config 全量（契约 §2.7：rois 热更新立即生效）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Message, Modal, Skeleton, Switch, Tag } from '@arco-design/web-react'
import {
  IconCamera,
  IconClose,
  IconDelete,
  IconRefresh,
  IconSave,
  IconUndo,
} from '@arco-design/web-react/icon'
import { fetchConfig, fetchStatus, manualSnapshot, saveConfig, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import { mediaUrl, snapshotUrl } from '../api/media'
import type { Config, Roi, Status } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { ErrorState, InitialLoading } from '../components/StateViews'
import { useAsync } from '../hooks/useAsync'
import { useStreamFrame } from '../hooks/useStreamFrame'

const MAX_ROIS = 8
const MIN_SIZE = 0.02

interface DraftRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

export function LivePage() {
  const statusAsync = useAsync<Status>((s) => fetchStatus(s), [], { pollMs: 5000 })
  const configAsync = useAsync<Config>((s) => fetchConfig(s), [])

  const [rois, setRois] = useState<Roi[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [armPending, setArmPending] = useState(false)
  const [snapBusy, setSnapBusy] = useState(false)
  const [shot, setShot] = useState<{ file: string; url: string } | null>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [bust, setBust] = useState(() => Date.now())

  const wrapRef = useRef<HTMLDivElement>(null)
  const frame = useStreamFrame(true)
  const dirtyRef = useRef(false)
  const syncedRef = useRef<Config | null>(null)

  /** 同步 dirty 到 ref，供 effect 读取而不触发额外渲染 */
  const markDirty = useCallback((v: boolean) => {
    dirtyRef.current = v
    setDirty(v)
  }, [])

  // 服务器配置到达时同步到本地 ROI 编辑态。
  // 用对象身份判重 + dirtyRef：保存后立即 setDirty(false) 不会把「旧配置」回灌覆盖刚保存的值。
  useEffect(() => {
    const cfg = configAsync.data
    if (!cfg || syncedRef.current === cfg) return
    syncedRef.current = cfg
    if (!dirtyRef.current) setRois(cfg.motion.rois)
  }, [configAsync.data])

  const connected = statusAsync.data?.camera.connected ?? false
  const fps = statusAsync.data?.camera.fps

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imgLoaded) return
    const p = toNorm(e.clientX, e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return
    const p = toNorm(e.clientX, e.clientY)
    setDraft({ ...draft, x1: p.x, y1: p.y })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const x = Math.min(draft.x0, draft.x1)
    const y = Math.min(draft.y0, draft.y1)
    const w = Math.abs(draft.x1 - draft.x0)
    const h = Math.abs(draft.y1 - draft.y0)
    setDraft(null)
    if (w < MIN_SIZE || h < MIN_SIZE) {
      Message.info('区域太小，请拖拽出更明显的矩形')
      return
    }
    if (rois.length >= MAX_ROIS) {
      Message.warning(`最多 ${MAX_ROIS} 个检测区域，请先删除已有区域`)
      return
    }
    setRois((prev) => [...prev, [x, y, w, h] as Roi])
    markDirty(true)
  }

  const removeRoi = (idx: number) => {
    setRois((prev) => prev.filter((_, i) => i !== idx))
    markDirty(true)
  }

  const clearRois = () => {
    setRois([])
    markDirty(true)
  }

  const resetRois = () => {
    markDirty(false)
    configAsync.reload()
  }

  const saveRois = async () => {
    const cfg = configAsync.data
    if (!cfg) return
    setSaving(true)
    try {
      await saveConfig({ ...cfg, motion: { ...cfg.motion, rois } })
      markDirty(false)
      configAsync.reload()
      Message.success(rois.length === 0 ? '已保存：恢复全屏检测' : `已保存 ${rois.length} 个检测区域，已热更新生效`)
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleArm = async (next: boolean) => {
    setArmPending(true)
    try {
      await setArmed(next)
      Message.success(next ? '已布防' : '已撤防')
      statusAsync.reload()
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setArmPending(false)
    }
  }

  const doSnapshot = async () => {
    setSnapBusy(true)
    try {
      const res = await manualSnapshot()
      setShot(res)
      Message.success(`已抓拍并保存：${res.file}`)
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setSnapBusy(false)
    }
  }

  if (configAsync.loading && !configAsync.data) return <InitialLoading rows={4} />
  if (configAsync.error && !configAsync.data) {
    return <ErrorState title="配置加载失败" error={configAsync.error} onRetry={configAsync.reload} />
  }

  const draftRect: Roi | null = draft
    ? [
        Math.min(draft.x0, draft.x1),
        Math.min(draft.y0, draft.y1),
        Math.abs(draft.x1 - draft.x0),
        Math.abs(draft.y1 - draft.y0),
      ]
    : null

  const maskText = frame.failed
    ? '实时画面加载失败，请检查相机连接后重试'
    : statusAsync.data && !connected
      ? '摄像头未连接，正在等待取流'
      : ''

  return (
    <>
      <PageHeader
        title="实时"
        description="预览当前画面、手动抓拍，并在截图上划定移动侦测区域（ROI）。"
        actions={
          <>
            <Button icon={<IconCamera />} loading={snapBusy} onClick={doSnapshot}>
              抓拍
            </Button>
            <Button
              icon={<IconRefresh />}
              onClick={() => {
                statusAsync.reload()
                setBust(Date.now())
              }}
            >
              刷新
            </Button>
          </>
        }
      />

      <div className="ch-split">
        <Panel
          title="实时画面"
          extra={
            <span className="ch-muted num">
              {fps != null ? `${fps.toFixed(1)} fps` : '— fps'}
              {statusAsync.data ? ` · ${statusAsync.data.camera.width}×${statusAsync.data.camera.height}` : ''}
            </span>
          }
          bodyStyle={{ padding: 0 }}
        >
          <div className="ch-stream-box">
            {frame.src ? (
              <img
                className="ch-stream-frame"
                src={frame.src}
                alt="实时画面"
                onError={frame.markFailed}
              />
            ) : null}
            {frame.src ? (
              <span className="ch-stream-fps num">
                {fps != null ? `${fps.toFixed(1)} fps` : '— fps'}
              </span>
            ) : null}
            {maskText ? (
              <div className="ch-stream-mask">
                <span className={`ch-status-dot ${frame.failed ? 'err' : 'warn'}`} />
                <div>{maskText}</div>
                <Button size="small" onClick={frame.retry}>
                  重试
                </Button>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="布防"
          extra={
            <Tag color={statusAsync.data?.armed ? 'green' : 'gray'} size="small">
              {statusAsync.data?.armed ? '布防中' : '已撤防'}
            </Tag>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Switch
              checked={!!statusAsync.data?.armed}
              loading={armPending}
              disabled={!statusAsync.data}
              onChange={toggleArm}
              aria-label="布防开关"
            />
            <div style={{ fontSize: 13, color: 'var(--color-text-2)' }}>
              {statusAsync.data?.armed
                ? '移动侦测事件将入库并推送'
                : '仅停止事件入库与推送，录像按日程继续'}
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="检测区域（ROI）"
        extra={
          <span className="ch-muted num">
            {rois.length}/{MAX_ROIS}
          </span>
        }
        style={{ marginTop: 'var(--ch-space-md)' }}
      >
          <div className="ch-roi-toolbar">
            <Button size="small" icon={<IconRefresh />} onClick={() => setBust(Date.now())}>
              刷新底图
            </Button>
            <Button size="small" icon={<IconUndo />} disabled={!dirty} onClick={resetRois}>
              撤销改动
            </Button>
            <Button size="small" icon={<IconDelete />} disabled={rois.length === 0} onClick={clearRois}>
              清空
            </Button>
          </div>

          <div
            className="ch-roi-wrap"
            ref={wrapRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDraft(null)}
            role="application"
            aria-label="ROI 绘制区域，拖拽鼠标画出矩形"
          >
            <img
              src={snapshotUrl(bust)}
              alt="ROI 编辑底图"
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(true)}
            />
            {!imgLoaded ? (
              <div style={{ position: 'absolute', inset: 0 }}>
                <Skeleton loading animation style={{ width: '100%', height: '100%' }} />
              </div>
            ) : null}

            {rois.map((r, i) => (
              <div
                key={i}
                className="ch-roi-rect"
                style={{ left: pct(r[0]), top: pct(r[1]), width: pct(r[2]), height: pct(r[3]) }}
              >
                <span className="ch-roi-tag num">区域 {i + 1}</span>
                <button
                  className="ch-roi-del"
                  type="button"
                  aria-label={`删除区域 ${i + 1}`}
                  title="删除该区域"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeRoi(i)
                  }}
                >
                  <IconClose />
                </button>
              </div>
            ))}

            {draftRect ? (
              <div
                className="ch-roi-rect drawing"
                style={{
                  left: pct(draftRect[0]),
                  top: pct(draftRect[1]),
                  width: pct(draftRect[2]),
                  height: pct(draftRect[3]),
                }}
              />
            ) : null}
          </div>

          <div className="ch-muted" style={{ marginTop: 8, lineHeight: '18px' }}>
            在截图上按住鼠标拖拽即可画框；点框右上角 ✕ 删除。空 = 全屏检测。
          </div>

          {rois.length > 0 ? (
            <div className="ch-roi-list">
              {rois.map((r, i) => (
                <div className="ch-roi-item" key={i}>
                  <span style={{ flex: 1 }} className="num">
                    #{i + 1} x {r[0].toFixed(3)} y {r[1].toFixed(3)} w {r[2].toFixed(3)} h{' '}
                    {r[3].toFixed(3)}
                  </span>
                  <Button
                    size="mini"
                    status="danger"
                    type="text"
                    icon={<IconClose />}
                    aria-label={`删除区域 ${i + 1}`}
                    onClick={() => removeRoi(i)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="ch-muted" style={{ marginTop: 8 }}>
              当前无检测区域，变化像素按全屏统计。
            </div>
          )}

          <div className="ch-savebar">
            <Button
              type="primary"
              icon={<IconSave />}
              loading={saving}
              disabled={!dirty}
              onClick={saveRois}
            >
              保存区域
            </Button>
            <span className="ch-muted">
              {dirty ? '有未保存的改动' : '与服务器一致'}
            </span>
          </div>
        </Panel>

      <Modal
        visible={!!shot}
        title="抓拍结果"
        footer={<Button onClick={() => setShot(null)}>关闭</Button>}
        onCancel={() => setShot(null)}
        autoFocus={false}
      >
        {shot ? (
          <>
            <img
              src={mediaUrl(shot.url)}
              alt="抓拍画面"
              style={{ width: '100%', borderRadius: 8, display: 'block' }}
            />
            <div className="ch-muted" style={{ marginTop: 8 }}>
              文件：{shot.file}
            </div>
          </>
        ) : null}
      </Modal>
    </>
  )
}
