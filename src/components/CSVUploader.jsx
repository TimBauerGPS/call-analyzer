import { useRef, useState } from 'react'
import { parseJobCSV } from '../lib/parseCSV'

const STALE_DAYS = 5

function daysSince(dateStr) {
  if (!dateStr) return Infinity
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

/**
 * Drag-and-drop CSV upload for job management data (Albiware or generic).
 * Calls onLoaded({ jobMap, rowCount }) on success.
 * Shows a staleness warning if the CSV hasn't been updated in 5+ days.
 */
export default function CSVUploader({ jobMap, uploadedAt, rowCount, onLoaded, onClear }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef()

  const days = daysSince(uploadedAt)
  const isStale = days >= STALE_DAYS

  async function processFile(file) {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setError('Please select a CSV file (.csv)')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await parseJobCSV(file)
      onLoaded(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  // Staleness warning — shown in both loaded and unloaded states
  const stalenessWarning = uploadedAt && isStale ? (
    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠</span>
      <p className="text-xs text-amber-700">
        Please update Albi Data. It has not been updated since{' '}
        <strong>{formatDate(uploadedAt)}</strong>.
      </p>
    </div>
  ) : null

  if (jobMap && jobMap.size > 0) {
    return (
      <div className="space-y-2">
        {stalenessWarning}
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <span className="text-sm font-medium text-green-800">Job CSV loaded</span>
            <span className="text-xs text-green-600 ml-2">
              {jobMap.size.toLocaleString()} unique phones
              {rowCount && rowCount > jobMap.size
                ? ` from ${rowCount.toLocaleString()} rows`
                : ''}
            </span>
          </div>
          <button
            onClick={onClear}
            className="text-xs text-green-700 hover:text-green-900 underline"
          >
            Clear
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {stalenessWarning}
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={e => { if (e.target.files[0]) processFile(e.target.files[0]) }}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
            <p className="text-sm text-gray-500">Parsing CSV…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-700">Upload Job CSV</p>
            <p className="text-xs text-gray-500">Albiware export or any CSV with a phone number column</p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}
