/**
 * 今日事件趋势 —— 轻量 SVG 柱图（24 小时）。
 * 不用图表库：单一维度、24 根柱，手写 SVG 更轻更可控，且与暗色主题天然一致。
 */
import { useState } from 'react'
import { toLocalDateStr } from '../utils/format'

const W = 480
const H = 116
const BAR_GAP = 3

export function HourlyChart({
  hourly,
  date,
  height = H,
}: {
  /** 长度 24 的当日每小时事件数 */
  hourly: number[]
  /** YYYY-MM-DD，用于判断是否高亮"当前小时" */
  date: string
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const values = hourly.length === 24 ? hourly : Array.from({ length: 24 }, (_, i) => hourly[i] ?? 0)
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  const isToday = date === toLocalDateStr(new Date())
  const nowHour = new Date().getHours()
  const barW = (W - BAR_GAP * 23) / 24

  const peak = values.indexOf(Math.max(...values))

  return (
    <div>
      <div style={{ position: 'relative', height }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${date} 每小时事件数柱状图，共 ${total} 条`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {/* 基线 */}
          <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="var(--color-border-2)" strokeWidth={1} />
          {/* 当前小时定位带 */}
          {isToday ? (
            <rect
              x={nowHour * (barW + BAR_GAP) - BAR_GAP / 2}
              y={0}
              width={barW + BAR_GAP}
              height={H}
              fill="var(--color-fill-1)"
            />
          ) : null}
          {values.map((v, i) => {
            const h = v === 0 ? 2 : Math.max(3, (v / max) * (H - 8))
            const x = i * (barW + BAR_GAP)
            const y = H - h
            const isNow = isToday && i === nowHour
            const color = v === 0 ? 'var(--color-fill-2)' : isNow ? 'var(--ch-warn)' : 'var(--ch-primary)'
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: 'opacity 120ms ease-out' }}
                />
                {/* 命中区域放大，避免细柱难以悬停 */}
                <rect
                  x={x}
                  y={0}
                  width={barW + BAR_GAP}
                  height={H}
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
              top: -4,
              transform: 'translate(-50%, -100%)',
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--color-bg-3)',
              border: '1px solid var(--color-border-2)',
              color: 'var(--color-text-1)',
              fontSize: 12,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {String(hover).padStart(2, '0')}:00 · <span className="num">{values[hover]}</span> 条
          </div>
        ) : null}
      </div>

      {/* 小时刻度：每 3 小时标一次，避免拥挤 */}
      <div style={{ display: 'flex', marginTop: 4 }}>
        {values.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 10,
              color: isToday && i === nowHour ? 'var(--ch-warn)' : 'var(--color-text-3)',
            }}
          >
            {i % 3 === 0 ? i : ''}
          </div>
        ))}
      </div>

      <div className="ch-muted" style={{ marginTop: 4 }}>
        合计 <span className="num">{total}</span> 条
        {total > 0 ? (
          <>
            ，高峰 <span className="num">{String(peak).padStart(2, '0')}:00</span>（
            <span className="num">{values[peak]}</span> 条）
          </>
        ) : (
          '，今日暂无事件'
        )}
      </div>
    </div>
  )
}
