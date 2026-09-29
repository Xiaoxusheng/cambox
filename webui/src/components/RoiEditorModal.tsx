/**
 * ROI 检测区域编辑弹层（v1.2 从监控页版面收进 Modal，契约 §4.2）。
 * 在当前帧快照上拖拽画框；保存走 POST /api/config 全量（契约 §2.7：motion.rois 热更新立即生效）。
 * 每次打开重新挂载内部组件：拉取最新配置，关闭即丢弃未保存的草稿。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Message, Modal, Skeleton } from '@arco-design/web-react'
import {
  IconClose,
  IconDelete,
  IconRefresh,
  IconSave,
  IconUndo,
} from '@arco-design/web-react/icon'
import { fetchConfig, saveConfig } from '../api/endpoints'
import { errorText } from '../api/errors'
import { snapshotUrl } from '../api/media'
import type { Config, Roi } from '../api/types'
import { ErrorState, InitialLoading } from './StateViews'
import { useAsync } from '../hooks/useAsync'

const MAX_ROIS = 8
const MIN_SIZE = 0.02

interface DraftRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

function RoiEditorInner({ onDone }: { onDone: () => void }) {
  const configAsync = useAsync<Config>((s) => fetchConfig(s), [])

  const [rois, setRois] = useState<Roi[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgAspect, setImgAspect] = useState(16 / 9)
  const [bust, setBust] = useState(() => Date.now())

  const wrapRef = useRef<HTMLDivElement>(null)
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
      Message.success(
        rois.length === 0 ? '已保存：恢复全屏检测' : `已保存 ${rois.length} 个检测区域，已热更新生效`,
      )
      onDone()
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  if (configAsync.loading && !configAsync.data) return <InitialLoading rows={4} />
  if (configAsync.error && !configAsync.data) {
    return (
      <ErrorState title="配置加载失败" error={configAsync.error} onRetry={configAsync.reload} />
    )
  }

  const draftRect: Roi | null = draft
    ? [
        Math.min(draft.x0, draft.x1),
        Math.min(draft.y0, draft.y1),
        Math.abs(draft.x1 - draft.x0),
        Math.abs(draft.y1 - draft.y0),
      ]
    : null

  return (
    <>
      <div className="cam-roi-toolbar">
        <Button size="small" icon={<IconRefresh />} onClick={() => setBust(Date.now())}>
          刷新底图
        </Button>
        <Button size="small" icon={<IconUndo />} disabled={!dirty} onClick={resetRois}>
          撤销改动
        </Button>
        <Button size="small" icon={<IconDelete />} disabled={rois.length === 0} onClick={clearRois}>
          清空
        </Button>
        <span className="cam-num text-body-secondary text-cam-text-tertiary" style={{ marginLeft: 'auto' }}>
          {rois.length}/{MAX_ROIS}
        </span>
      </div>

      <div
        className="cam-roi-wrap"
        ref={wrapRef}
        style={{
          aspectRatio: imgAspect.toFixed(4),
          maxWidth: `min(100%, calc((100vh - 350px) * ${imgAspect.toFixed(3)}))`,
        }}
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
          onLoad={(e) => {
            setImgLoaded(true)
            const n = e.currentTarget
            if (n.naturalWidth > 0 && n.naturalHeight > 0) {
              setImgAspect(n.naturalWidth / n.naturalHeight)
            }
          }}
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
            className="cam-roi-rect"
            style={{ left: pct(r[0]), top: pct(r[1]), width: pct(r[2]), height: pct(r[3]) }}
          >
            <span className="cam-roi-tag cam-num">区域 {i + 1}</span>
            <button
              className="cam-roi-del"
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
            className="cam-roi-rect drawing"
            style={{
              left: pct(draftRect[0]),
              top: pct(draftRect[1]),
              width: pct(draftRect[2]),
              height: pct(draftRect[3]),
            }}
          />
        ) : null}
      </div>

      <div className="text-body-secondary text-cam-text-tertiary" style={{ marginTop: 8, lineHeight: '18px' }}>
        在截图上按住鼠标拖拽即可画框；点框右上角 ✕ 删除。空 = 全屏检测。
      </div>

      {rois.length > 0 ? (
        <div className="cam-roi-list">
          {rois.map((r, i) => (
            <div className="cam-roi-item" key={i}>
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
        <div className="text-body-secondary text-cam-text-tertiary" style={{ marginTop: 8 }}>
          当前无检测区域，变化像素按全屏统计。
        </div>
      )}

      <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-3 border-t border-cam-border bg-cam-surface pt-3">
        <Button
          type="primary"
          icon={<IconSave />}
          loading={saving}
          disabled={!dirty}
          onClick={saveRois}
        >
          保存区域
        </Button>
        <span className="text-body-secondary text-cam-text-tertiary">{dirty ? '有未保存的改动' : '与服务器一致'}</span>
      </div>
    </>
  )
}

export function RoiEditorModal({
  visible,
  onCancel,
}: {
  visible: boolean
  onCancel: () => void
}) {
  return (
    <Modal
      title="检测区域（ROI）"
      visible={visible}
      style={{ width: 'min(920px, 94vw)' }}
      footer={null}
      onCancel={onCancel}
      autoFocus={false}
      unmountOnExit
    >
      {/* 底图按视口高度自适应（见 cam-roi-wrap 的 maxWidth），内容天然放得下，无滚动条 */}
      {visible ? <RoiEditorInner onDone={onCancel} /> : null}
    </Modal>
  )
}
