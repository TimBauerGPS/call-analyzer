/**
 * Summary statistics bar above the call list.
 * Computed from the currently filtered set of calls.
 */
import { isPpcAttributedCall } from '../lib/callAttribution'

export default function StatsBar({ calls }) {
  if (!calls.length) return null

  const complete = calls.filter(c => c.analysis_status === 'complete')
  const viableLeads = complete.filter(c => c.viable_lead === 'Yes')
  const viableCount = viableLeads.length
  const scheduled = complete.filter(c => c.scheduled === true).length
  const ppc = complete.filter(isPpcAttributedCall).length
  const scores = complete.filter(c => c.sentiment_score != null).map(c => c.sentiment_score)
  const avgSentiment = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null

  // Albi metrics — a call "has Albi data" if it was matched to a CSV row
  const hasAlbi = c => !!(c.customer_name || c.albi_url || c.job_id)
  const addedToAlbi = viableLeads.filter(hasAlbi).length
  const signedInAlbi = viableLeads.filter(c => hasAlbi(c) && c.contract_signed).length

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0)

  const stats = [
    { label: 'Total Calls',    value: calls.length },
    { label: 'Viable Leads',   value: `${viableCount} (${pct(viableCount, calls.length)}%)` },
    { label: 'Scheduled',      value: `${scheduled} (${pct(scheduled, calls.length)}%)` },
    { label: 'PPC',            value: `${ppc} (${pct(ppc, calls.length)}%)` },
    { label: 'Avg Sentiment',  value: avgSentiment != null ? `${avgSentiment}/100` : '—' },
    {
      label: 'Added to Albi',
      value: `${addedToAlbi} (${pct(addedToAlbi, viableCount)}%)`,
      sub: 'of viable leads',
    },
    {
      label: 'Signed in Albi',
      value: `${signedInAlbi} (${pct(signedInAlbi, addedToAlbi)}%)`,
      sub: 'of Albi matches',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
      {stats.map(({ label, value, sub }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-500 font-medium">{label}</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
      ))}
    </div>
  )
}
