import { useMemo, useState, useEffect } from 'react'
import CallCard from './CallCard'
import StatsBar from './StatsBar'
import { isPpcAttributedCall } from '../lib/callAttribution'

const CALLS_PER_PAGE = 25

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest First' },
  { value: 'date_asc', label: 'Oldest First' },
  { value: 'duration_desc', label: 'Longest Call' },
  { value: 'sentiment_desc', label: 'Highest Sentiment' },
  { value: 'sentiment_asc', label: 'Lowest Sentiment' },
  { value: 'handler_asc', label: 'Handler (A–Z)' },
]

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export default function CallList({ calls, onDeepAnalyze, onRetry, partners = [] }) {
  const [sort, setSort] = useState('date_desc')
  const [filterHandler, setFilterHandler] = useState('all')
  const [filterViable, setFilterViable] = useState('all')
  const [filterScheduled, setFilterScheduled] = useState('all')
  const [filterPpc, setFilterPpc] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterAlbi, setFilterAlbi] = useState('all')
  const [filterPartner, setFilterPartner] = useState('all')
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setCurrentPage(1) }, [search, filterHandler, filterViable, filterScheduled, filterPpc, filterStatus, filterAlbi, filterPartner, sort])

  // Build unique handler list for dropdown
  const handlerOptions = useMemo(() => {
    const names = [...new Set(calls.map(c => c.handler_name).filter(Boolean))].sort()
    return [{ value: 'all', label: 'All Handlers' }, ...names.map(n => ({ value: n, label: n }))]
  }, [calls])

  // Build partner options — prefer the configured partners list; fall back to call data
  const partnerOptions = useMemo(() => {
    const fromPartners = partners.map(p => p.company_name).filter(Boolean).sort()
    const fromCalls = [...new Set(calls.map(c => c.partner_company).filter(Boolean))].sort()
    const names = fromPartners.length > 0 ? fromPartners : fromCalls
    return names.length > 0
      ? [{ value: 'all', label: 'All Partners' }, ...names.map(n => ({ value: n, label: n }))]
      : []
  }, [calls, partners])

  const filtered = useMemo(() => {
    let result = [...calls]

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(c =>
        c.caller_number?.includes(q) ||
        c.handler_name?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q) ||
        c.source?.toLowerCase().includes(q)
      )
    }

    const hasAlbi = c => !!(c.customer_name || c.albi_url || c.job_id)
    const isSignedAlbi = c => Boolean(c.contract_signed)

    if (filterHandler !== 'all') result = result.filter(c => c.handler_name === filterHandler)
    if (filterViable !== 'all') result = result.filter(c => c.viable_lead === (filterViable === 'yes' ? 'Yes' : 'No'))
    if (filterScheduled !== 'all') result = result.filter(c => c.scheduled === (filterScheduled === 'yes'))
    if (filterPpc !== 'all') result = result.filter(c => isPpcAttributedCall(c) === (filterPpc === 'yes'))
    if (filterStatus !== 'all') result = result.filter(c => c.analysis_status === filterStatus)
    if (filterAlbi === 'all_albi')    result = result.filter(c => hasAlbi(c))
    if (filterAlbi === 'signed')      result = result.filter(c => hasAlbi(c) && isSignedAlbi(c))
    if (filterAlbi === 'pending')     result = result.filter(c => hasAlbi(c) && !isSignedAlbi(c) && c.job_status !== 'Closed' && c.job_status !== 'Lost')
    if (filterAlbi === 'lost')        result = result.filter(c => hasAlbi(c) && c.job_status === 'Lost')
    if (filterPartner !== 'all')      result = result.filter(c => c.partner_company === filterPartner)

    result.sort((a, b) => {
      switch (sort) {
        case 'date_asc': return new Date(a.call_date) - new Date(b.call_date)
        case 'date_desc': return new Date(b.call_date) - new Date(a.call_date)
        case 'duration_desc': return (b.duration_seconds || 0) - (a.duration_seconds || 0)
        case 'sentiment_desc': return (b.sentiment_score ?? -1) - (a.sentiment_score ?? -1)
        case 'sentiment_asc': return (a.sentiment_score ?? 101) - (b.sentiment_score ?? 101)
        case 'handler_asc': return (a.handler_name || '').localeCompare(b.handler_name || '')
        default: return 0
      }
    })

    return result
  }, [calls, sort, filterHandler, filterViable, filterScheduled, filterPpc, filterStatus, filterAlbi, filterPartner, search])

  const totalPages = Math.ceil(filtered.length / CALLS_PER_PAGE)
  const paginated = filtered.slice((currentPage - 1) * CALLS_PER_PAGE, currentPage * CALLS_PER_PAGE)

  return (
    <div>
      <StatsBar calls={filtered} />

      {/* Filter toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 min-w-40">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search calls…"
            className="flex-1 text-xs border-none outline-none bg-transparent placeholder-gray-400"
          />
        </div>

        <div className="h-4 w-px bg-gray-200" />

        <FilterSelect
          label="Handler"
          value={filterHandler}
          onChange={setFilterHandler}
          options={handlerOptions}
        />
        <FilterSelect
          label="Viable Lead"
          value={filterViable}
          onChange={setFilterViable}
          options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        />
        <FilterSelect
          label="Scheduled"
          value={filterScheduled}
          onChange={setFilterScheduled}
          options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        />
        <FilterSelect
          label="PPC"
          value={filterPpc}
          onChange={setFilterPpc}
          options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        />
        <FilterSelect
          label="Status"
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'complete', label: 'Complete' },
            { value: 'processing', label: 'Processing' },
            { value: 'pending', label: 'Pending' },
            { value: 'error', label: 'Error' },
          ]}
        />
        {partnerOptions.length > 0 && (
          <FilterSelect
            label="Partner"
            value={filterPartner}
            onChange={setFilterPartner}
            options={partnerOptions}
          />
        )}
        <FilterSelect
          label="Albi Leads"
          value={filterAlbi}
          onChange={setFilterAlbi}
          options={[
            { value: 'all',      label: 'All Calls' },
            { value: 'all_albi', label: 'All Albi Leads' },
            { value: 'signed',   label: 'Signed Albi Leads' },
            { value: 'pending',  label: 'Pending Albi' },
            { value: 'lost',     label: 'Lost Albi' },
          ]}
        />

        <div className="h-4 w-px bg-gray-200" />

        <FilterSelect
          label="Sort"
          value={sort}
          onChange={setSort}
          options={SORT_OPTIONS}
        />

        <span className="text-xs text-gray-400 ml-auto">{filtered.length} calls</span>
      </div>

      {/* Pagination — top */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mb-3 px-1">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {currentPage} of {totalPages} &nbsp;·&nbsp; {filtered.length} calls
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}

      {/* Call cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No calls match your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginated.map(call => (
            <CallCard key={call.id} call={call} onDeepAnalyze={onDeepAnalyze} onRetry={onRetry} />
          ))}
        </div>
      )}

      {/* Pagination — bottom */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <button
            onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            disabled={currentPage === 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            disabled={currentPage === totalPages}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
