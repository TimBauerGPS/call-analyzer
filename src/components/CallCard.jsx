import { useState } from 'react'
import SentimentBar from './SentimentBar'

const STATUS_STYLES = {
  complete: 'bg-green-100 text-green-800',
  processing: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-700',
}

function Badge({ label, value, colorClass }) {
  if (value == null) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label && <span className="opacity-60">{label}</span>}
      {value}
    </span>
  )
}

function BoolBadge({ label, value }) {
  if (value == null) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
      {label}: {value ? 'Yes' : 'No'}
    </span>
  )
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function CallCard({ call, onDeepAnalyze }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDeep, setConfirmDeep] = useState(false)
  const [deepLoading, setDeepLoading] = useState(false)

  const isDeep = call.analysis_tier === 'deep'
  const canDeepAnalyze = call.analysis_status === 'complete' && !isDeep && onDeepAnalyze

  async function handleDeepConfirm() {
    setConfirmDeep(false)
    setDeepLoading(true)
    await onDeepAnalyze(call)
    setDeepLoading(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Card header */}
      <div
        className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left: phone + meta */}
          <div className="flex-1 min-w-0">
            {/* Phone number + customer name */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-gray-900 text-sm">
                {call.caller_number || '—'}
              </span>
              {call.customer_name && (
                <span className="text-sm font-medium text-gray-700">— {call.customer_name}</span>
              )}
              {call.handler_name && (
                <span className="text-xs text-gray-500">• {call.handler_name}</span>
              )}
            </div>

            {/* Badges row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {call.source && (
                <Badge
                  value={call.source}
                  colorClass={call.is_ppc ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600'}
                />
              )}
              {call.is_ppc && (
                <Badge value="PPC" colorClass="bg-orange-100 text-orange-800" />
              )}
              {call.viable_lead === 'Yes' && (
                <Badge value="Viable Lead" colorClass="bg-teal-100 text-teal-800" />
              )}
              {call.scheduled && (
                <Badge value="Scheduled" colorClass="bg-green-100 text-green-800" />
              )}
              {call.job_status && (
                <Badge label="Albi:" value={call.job_status} colorClass="bg-slate-100 text-slate-700" />
              )}
              {call.contract_signed && (
                <Badge value="Signed" colorClass="bg-emerald-100 text-emerald-800" />
              )}
              {call.albi_url && (
                <a
                  href={call.albi_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                >
                  🔗 Albi
                </a>
              )}
              {isDeep && (
                <Badge value="Deep" colorClass="bg-purple-100 text-purple-800" />
              )}
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span>{formatDate(call.call_date)}</span>
              <span>{formatDuration(call.duration_seconds)}</span>
            </div>
          </div>

          {/* Right: status + sentiment */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[call.analysis_status] || STATUS_STYLES.pending}`}>
              {call.analysis_status || 'pending'}
            </span>
            {call.sentiment_score != null && (
              <div className="w-28">
                <SentimentBar score={call.sentiment_score} sentiment={call.sentiment} />
              </div>
            )}
          </div>
        </div>

        {/* Inline notes preview */}
        {!expanded && call.notes && (
          <p className="mt-2 text-xs text-gray-500 line-clamp-2">{call.notes}</p>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4 bg-gray-50">
          {/* Outcome badges */}
          <div className="flex flex-wrap gap-2">
            <BoolBadge label="Introduced" value={call.introduced} />
            <BoolBadge label="Scheduled" value={call.scheduled} />
            <BoolBadge label="CB Requested" value={call.cb_requested} />
          </div>

          {/* Job info */}
          {(call.job_id || call.job_type || call.job_status || call.contract_signed) && (
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-xs space-y-1">
              <div className="font-medium text-gray-700 mb-1">Albi Job</div>
              {call.job_id && <div><span className="text-gray-500">ID:</span> {call.job_id}</div>}
              {call.job_type && <div><span className="text-gray-500">Type:</span> {call.job_type}</div>}
              {call.job_status && <div><span className="text-gray-500">Status:</span> {call.job_status}</div>}
              {call.contract_signed && (
                <div><span className="text-gray-500">Contract Signed:</span> <span className="text-emerald-700 font-medium">{call.contract_signed}</span></div>
              )}
            </div>
          )}

          {/* Notes */}
          {call.notes && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Notes</div>
              <p className="text-sm text-gray-800 leading-relaxed">{call.notes}</p>
            </div>
          )}

          {/* Sales tips */}
          {call.sales_tips && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Sales Tips</div>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{call.sales_tips}</p>
            </div>
          )}

          {/* Coaching tips */}
          {call.coaching_tips?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Coaching</div>
              <ul className="space-y-1">
                {call.coaching_tips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-800">
                    <span className="text-brand-500 flex-shrink-0">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missed flags */}
          {call.missed_flags?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-orange-600 mb-1">Missed Opportunities</div>
              <ul className="space-y-1">
                {call.missed_flags.map((flag, i) => (
                  <li key={i} className="flex gap-2 text-sm text-orange-700">
                    <span className="flex-shrink-0">⚠</span>
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Deep analysis results */}
          {isDeep && (call.tonal_feedback || call.talk_time_ratio) && (
            <div className="bg-purple-50 rounded-lg border border-purple-200 p-3 space-y-2">
              <div className="text-xs font-semibold text-purple-700">Deep Analysis</div>
              {call.tonal_feedback && (
                <div>
                  <div className="text-xs text-purple-600 mb-0.5">Tonal Feedback</div>
                  <p className="text-sm text-gray-800">{call.tonal_feedback}</p>
                </div>
              )}
              {call.talk_time_ratio && (
                <div>
                  <div className="text-xs text-purple-600 mb-0.5">Talk-Time Ratio</div>
                  <p className="text-sm text-gray-800">{call.talk_time_ratio}</p>
                </div>
              )}
            </div>
          )}

          {/* Attribution / PPC */}
          {(call.utm_term || call.utm_campaign || call.utm_medium || call.utm_source || call.gclid || call.landing_page_url) && (
            <div className="bg-orange-50 rounded-lg border border-orange-200 p-3 text-xs space-y-1">
              <div className="font-semibold text-orange-700 mb-1">Attribution</div>
              {call.utm_term && (
                <div><span className="text-orange-500">Search keyword:</span> <span className="text-gray-800 font-medium">{call.utm_term}</span></div>
              )}
              {call.utm_campaign && (
                <div><span className="text-orange-500">Campaign:</span> <span className="text-gray-800">{call.utm_campaign}</span></div>
              )}
              {call.utm_medium && (
                <div><span className="text-orange-500">Medium:</span> <span className="text-gray-800">{call.utm_medium}</span></div>
              )}
              {call.utm_source && (
                <div><span className="text-orange-500">Source:</span> <span className="text-gray-800">{call.utm_source}</span></div>
              )}
              {call.gclid && (
                <div className="flex items-center gap-1">
                  <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">G</span>
                  <span className="text-gray-600">Google Ads click confirmed</span>
                </div>
              )}
              {call.landing_page_url && (
                <div className="truncate">
                  <span className="text-orange-500">Landing page:</span>{' '}
                  <a href={call.landing_page_url} target="_blank" rel="noopener noreferrer"
                    className="text-brand-600 hover:underline truncate"
                    onClick={e => e.stopPropagation()}
                  >
                    {call.landing_page_url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Transcript */}
          {call.transcript && (
            <details className="group">
              <summary className="text-xs font-semibold text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                Transcript ▸
              </summary>
              <p className="mt-2 text-xs text-gray-600 leading-relaxed whitespace-pre-line font-mono bg-white border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto">
                {call.transcript}
              </p>
            </details>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            {call.recording_url && (
              <a
                href={call.recording_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:underline flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Listen in CallRail
              </a>
            )}

            {canDeepAnalyze && (
              <button
                onClick={e => { e.stopPropagation(); setConfirmDeep(true) }}
                disabled={deepLoading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-100 text-purple-800 hover:bg-purple-200 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {deepLoading ? (
                  <>
                    <span className="animate-spin inline-block w-3 h-3 border border-purple-600 border-t-transparent rounded-full" />
                    Analyzing…
                  </>
                ) : (
                  '🎧 Deep Analyze'
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Deep analyze confirmation modal */}
      {confirmDeep && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setConfirmDeep(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 mb-2">Run Deep Analysis?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Deep analysis uses GPT-4o Audio Preview, which is more expensive than the standard tier.
              It will provide tonal feedback and talk-time ratios directly from the audio.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDeep(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeepConfirm}
                className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700"
              >
                Run Deep Analysis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
