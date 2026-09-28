/** 存储水位条：用量 / 上限，按阈值着色 */
import { formatBytes } from '../utils/format'

const GB = 1024 ** 3

export function StorageMeter({
  usedBytes,
  maxGb,
  showLabel = true,
}: {
  usedBytes: number
  maxGb: number
  showLabel?: boolean
}) {
  const maxBytes = Math.max(1, maxGb * GB)
  const pct = Math.min(100, (usedBytes / maxBytes) * 100)
  const color = pct >= 90 ? 'var(--ch-danger)' : pct >= 75 ? 'var(--ch-warn)' : 'var(--ch-ok)'

  return (
    <div>
      {showLabel ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--color-text-2)',
            marginBottom: 6,
          }}
        >
          <span className="num">
            {formatBytes(usedBytes)} / {maxGb} GB
          </span>
          <span className="num" style={{ color }}>
            {pct.toFixed(1)}%
          </span>
        </div>
      ) : null}
      <div
        className="ch-meter"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`存储使用率 ${pct.toFixed(1)}%`}
      >
        <div className="ch-meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
