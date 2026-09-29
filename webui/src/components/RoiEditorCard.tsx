/**
 * 设置页内联 ROI 编辑器（v1.3 按 camhub-ui-4k/06 设计稿）。
 * 与 RoiEditorModal（监控页、保存即生效）不同：这里只改 draft.motion.rois，
 * 随设置页「保存全部」一次性提交。支持拖拽画框、拖动移动、右下角手柄缩放、列表删除。
 */
import { useRef, useState } from 'react'
import { Button, Message } from '@arco-design/web-react'
import { IconPlus, IconRefresh } from '@arco-design/web-react/icon'
import { snapshotUrl } from '../api/media'
import type { Roi } from '../api/types'

const MAX_ROIS = 8
const MIN_SIZE = 0.02

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

type Interaction =
  | { mode: 'draw'; x0: number; y0: number }
  | { mode: 'move'; idx: number; dx: number; dy: number; orig: Roi }
  | { mode: 'resize'; idx: number; orig: Roi }

export function RoiEditorCard({
  rois,
  onChange,
}: {
  rois: Roi[]
  onChange: (rois: Roi[]) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Roi | null>(null)
  const [inter, setInter] = useState<Interaction | null>(null)
  const [bust, setBust] = useState(() => Date.now())

  const toNorm = (clientX: number, clientY: number) => {
    const el = canvasRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 点在已有矩形 / 手柄上时由其自身 handler 处理（已 stopPropagation）
    const p = toNorm(e.clientX, e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
    setInter({ mode: 'draw', x0: p.x, y0: p.y })
    setDraft([p.x, p.y, 0, 0])
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!inter) return
    const p = toNorm(e.clientX, e.clientY)
    if (inter.mode === 'draw') {
      setDraft([
        Math.min(inter.x0, p.x),
        Math.min(inter.y0, p.y),
        Math.abs(p.x - inter.x0),
        Math.abs(p.y - inter.y0),
      ])
    } else if (inter.mode === 'move') {
      const [ox, oy, ow, oh] = inter.orig
      const nx = Math.min(Math.max(0, ox + (p.x - inter.dx)), 1 - ow)
      const ny = Math.min(Math.max(0, oy + (p.y - inter.dy)), 1 - oh)
      onChange(rois.map((r, i) => (i === inter.idx ? ([nx, ny, ow, oh] as Roi) : r)))
    } else {
      const [ox, oy] = inter.orig
      const nw = Math.min(Math.max(MIN_SIZE, p.x - ox), 1 - ox)
      const nh = Math.min(Math.max(MIN_SIZE, p.y - oy), 1 - oy)
      onChange(rois.map((r, i) => (i === inter.idx ? ([ox, oy, nw, nh] as Roi) : r)))
    }
  }

  const onPointerUp = () => {
    if (inter?.mode === 'draw' && draft) {
      if (draft[2] < MIN_SIZE || draft[3] < MIN_SIZE) {
        Message.info('区域太小，请拖拽出更明显的矩形')
      } else if (rois.length >= MAX_ROIS) {
        Message.warning(`最多 ${MAX_ROIS} 个检测区域，请先删除已有区域`)
      } else {
        onChange([...rois, draft])
      }
    }
    setInter(null)
    setDraft(null)
  }

  const startMove = (e: React.PointerEvent<HTMLElement>, idx: number) => {
    e.stopPropagation()
    const p = toNorm(e.clientX, e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
    setInter({ mode: 'move', idx, dx: p.x, dy: p.y, orig: [...rois[idx]] as Roi })
  }

  const startResize = (e: React.PointerEvent<HTMLElement>, idx: number) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setInter({ mode: 'resize', idx, orig: [...rois[idx]] as Roi })
  }

  const addDefault = () => {
    if (rois.length >= MAX_ROIS) {
      Message.warning(`最多 ${MAX_ROIS} 个检测区域`)
      return
    }
    onChange([...rois, [0.3, 0.3, 0.4, 0.4] as Roi])
  }

  return (
    <>
      <div
        ref={canvasRef}
        className="ch-roi-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="ROI 绘制区域：拖拽画框，拖动矩形移动，右下角手柄缩放"
      >
        <img src={snapshotUrl(bust)} alt="ROI 编辑底图" draggable={false} />
        {rois.map((r, i) => (
          <div
            key={i}
            className="ch-roi-rect"
            style={{ left: pct(r[0]), top: pct(r[1]), width: pct(r[2]), height: pct(r[3]) }}
            onPointerDown={(e) => startMove(e, i)}
            onPointerUp={onPointerUp}
          >
            <span className="ch-roi-tag num">
              ROI {i + 1} · {r[0].toFixed(2)}, {r[1].toFixed(2)} ~ {(r[0] + r[2]).toFixed(2)},{' '}
              {(r[1] + r[3]).toFixed(2)}
            </span>
            <span
              className="ch-roi-handle"
              role="button"
              aria-label={`缩放区域 ${i + 1}`}
              onPointerDown={(e) => startResize(e, i)}
              onPointerUp={onPointerUp}
            />
          </div>
        ))}
        {draft ? (
          <div
            className="ch-roi-rect drawing"
            style={{ left: pct(draft[0]), top: pct(draft[1]), width: pct(draft[2]), height: pct(draft[3]) }}
          />
        ) : null}
      </div>

      <div className="ch-roi-list">
        {rois.length === 0 ? (
          <span className="ch-muted">未设置检测区域，按全屏统计变化像素。</span>
        ) : (
          rois.map((r, i) => (
            <span key={i} className="ch-roi-item">
              ROI {i + 1} · {r[0].toFixed(2)}, {r[1].toFixed(2)} · {r[2].toFixed(2)}×{r[3].toFixed(2)}
              <Button
                type="text"
                size="mini"
                status="danger"
                aria-label={`删除区域 ${i + 1}`}
                onClick={() => onChange(rois.filter((_, k) => k !== i))}
              >
                删除
              </Button>
            </span>
          ))
        )}
        <Button type="dashed" size="small" icon={<IconPlus />} onClick={addDefault}>
          添加区域
        </Button>
        <Button
          type="text"
          size="small"
          icon={<IconRefresh />}
          aria-label="刷新底图"
          onClick={() => setBust(Date.now())}
        />
      </div>
      <div className="ch-hint">
        在画面上拖拽画出新区域；拖动矩形移动位置，右下角手柄缩放。坐标为归一化 0~1，随「保存全部」提交后热更新生效。
      </div>
    </>
  )
}
