/**
 * Summary statistics bar above the call list.
 * Computed from the currently filtered set of calls.
 */
export default function StatsBar({ calls }) {
  if (!calls.length) return null

  const complete = calls.filter(c => c.analysis_status === 'complete')
  const viableLeads = complete.filter(c => c.viable_lead === 'Yes').length
  const scheduled = complete.filter(c => c.scheduled === true).length
  const ppc = complete.filter(c => c.is_ppc === true).length
  const scores = complete.filter(c => c.sentiment_score != null).map(c => c.sentiment_score)
  const avgSentiment = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0)

  const stats = [
    { label: 'Total Calls', value: calls.length },
    { label: 'Viable Leads', value: `${viableLeads} (${pct(viableLeads, complete.length)}%)` },
    { label: 'Scheduled', value: `${scheduled} (${pct(scheduled, complete.length)}%)` },
    { label: 'PPC', value: `${ppc} (${pct(ppc, complete.length)}%)` },
    { label: 'Avg Sentiment', value: avgSentiment != null ? `${avgSentiment}/100` : '—' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-500 font-medium">{label}</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{value}</div>
        </div>
      ))}
    </div>
  )
}
