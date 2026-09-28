/**
 * 今日事件趋势 —— 轻量 SVG 柱图（24 小时，v1.3 设计稿样式）。
 * 不用图表库：单一维度、24 根柱，手写 SVG 更轻更可控。
 * 双系列：移动侦测（青）+ 画面自检（黄）。selfcheck 未传时视为全青。
 */
import { useState } from 'react'
import { toLocalDateStr } from '../utils/format'

const W = 960
const H = 240
const TOP_PAD = 10
const BAR_GAP = 10

export function HourlyChart({
  hourly,
  selfcheck,
  date,
  height = H,
}: {
  /** 长度 24 的当日每小时事件总数 */
  hourly: number[]
  /** 长度 24 的当日每小时自检事件数（可选；>0 的小时画黄柱） */
  selfcheck?: number[]
  /** YYYY-MM-DD，用于判断是否高亮"当前小时" */
  date: string
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const n = (a?: number[]) => Array.from({ length: 24 }, (_, i) => a?.[i] ?? 0)
  const values = hourly.length === 24 ? hourly.slice() : n(hourly)
  const sc = n(selfcheck)
  const max = Math.max(1, ...values)
  const isToday = date === toLocalDateStr(new Date())
  const nowHour = new Date().getHours()

  const slot = (W - BAR_GAP * 23) / 24
  const usable = H - TOP_PAD - 26

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${date} 每小时事件数柱状图，共 ${values.reduce((a, b) => a + b, 0)} 条`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* 横向网格线 */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={TOP_PAD + usable * f}
            y2={TOP_PAD + usable * f}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}
        {/* 基线 */}
        <line x1={0} y1={H - 26} x2={W} y2={H - 26} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />

        {values.map((v, i) => {
          const self = sc[i] ?? 0
          const motion = Math.max(0, v - self)
          const x = i * (slot + BAR_GAP)
          const hOf = (c: number) => (c === 0 ? 0 : Math.max(4, (c / max) * usable))
          const hm = hOf(motion)
          const hs = hOf(self)
          const cyanW = hs > 0 ? (slot - 4) / 2 : slot
          const amberW = (slot - 4) / 2
          const dim = hover !== null && hover !== i
          const isNow = isToday && i === nowHour
          return (
            <g key={i} opacity={dim ? 0.4 : 1} style={{ transition: 'opacity 120ms ease-out' }}>
              {isNow ? (
                <rect x={x - BAR_GAP / 2} y={0} width={slot + BAR_GAP} height={H} fill="rgba(255,255,255,0.04)" />
              ) : null}
              {motion > 0 ? (
                <rect
                  x={x}
                  y={H - 26 - hm}
                  width={cyanW}
                  height={hm}
                  rx={3}
                  fill="var(--ch-primary)"
                />
              ) : null}
              {self > 0 ? (
                <rect
                  x={hs > 0 && motion > 0 ? x + cyanW + 4 : x}
                  y={H - 26 - hs}
                  width={amberW}
                  height={hs}
                  rx={3}
                  fill="var(--ch-warn)"
                />
              ) : null}
              {/* 命中区域放大，避免细柱难以悬停 */}
              <rect
                x={x - BAR_GAP / 2}
                y={0}
                width={slot + BAR_GAP}
                height={H - 26}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}
      </svg>

      {hover !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${((hover + 0.5) / 24) * 100}%`,
            top: 0,
            transform: 'translateX(-50%)',
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(10,16,24,0.95)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--ch-text-1)',
            fontSize: 12,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <span className="num">{String(hover).padStart(2, '0')}:00</span>
          <span style={{ color: 'var(--ch-primary)' }}> · 侦测 {Math.max(0, values[hover] - (sc[hover] ?? 0))}</span>
          {(sc[hover] ?? 0) > 0 ? (
            <span style={{ color: 'var(--ch-warn)' }}> · 自检 {sc[hover]}</span>
          ) : null}
        </div>
      ) : null}

      {/* 小时刻度：每 4 小时标一次 */}
      <div style={{ display: 'flex', marginTop: 2 }}>
        {values.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: 'left',
              fontSize: 11,
              fontFamily: 'var(--ch-mono)',
              color: isToday && i === nowHour ? 'var(--ch-primary)' : 'var(--ch-text-3)',
            }}
          >
            {i % 4 === 0 ? `${String(i).padStart(2, '0')}` : ''}
          </div>
        ))}
      </div>
    </div>
  )
}
