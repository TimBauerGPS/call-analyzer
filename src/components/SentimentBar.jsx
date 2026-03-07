/**
 * Visual 0-100 sentiment score bar.
 * Red → Yellow → Green gradient.
 */
export default function SentimentBar({ score, sentiment }) {
  if (score == null) return null

  const pct = Math.max(0, Math.min(100, score))

  // Color: red at 0, yellow at 50, green at 100
  const hue = Math.round((pct / 100) * 120) // 0 = red, 120 = green
  const color = `hsl(${hue}, 70%, 45%)`

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums w-7 text-right" style={{ color }}>
        {pct}
      </span>
      {sentiment && (
        <span className="text-xs text-gray-500 capitalize">{sentiment}</span>
      )}
    </div>
  )
}
