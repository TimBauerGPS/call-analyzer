/**
 * Simple date range picker with quick-select presets.
 */
export default function DateRangePicker({ start, end, onChange }) {
  function setPreset(days) {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - days)
    onChange({
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
    })
  }

  const presets = [
    { label: '7d', days: 7 },
    { label: '14d', days: 14 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 text-sm">
        <input
          type="date"
          value={start}
          max={end}
          onChange={e => onChange({ start: e.target.value, end })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <span className="text-gray-400">→</span>
        <input
          type="date"
          value={end}
          min={start}
          onChange={e => onChange({ start, end: e.target.value })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div className="flex gap-1">
        {presets.map(({ label, days }) => (
          <button
            key={label}
            onClick={() => setPreset(days)}
            className="px-2.5 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
