import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { normalizePhone } from '../lib/phoneNormalize'
import CSVUploader from '../components/CSVUploader'
import DateRangePicker from '../components/DateRangePicker'
import CallList from '../components/CallList'

const API = (path) => `/.netlify/functions/${path}`

const DEFAULT_SALES_TIPS = `1. What could the handler have done to book this on the spot?
2. Was insurance mentioned as a funding source?
3. Was an appointment/inspection offered?
4. Did the caller appear interested?
5. General sales tips for this specific call.`

// --- Helpers ---
function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}

// Masked display: show first 6 chars then ••••••••
function maskKey(key) {
  if (!key) return ''
  return key.slice(0, 6) + '••••••••' + key.slice(-4)
}

// --- Main component ---
export default function Dashboard({ session }) {
  const [calls, setCalls] = useState([])
  const [jobMap, setJobMap] = useState(null)
  const [dateRange, setDateRange] = useState({ start: daysAgo(7), end: today() })
  const [fetchStatus, setFetchStatus] = useState(null)
  const [fetchMessage, setFetchMessage] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const processingRef = useRef(false)

  // Settings state
  const [userSettings, setUserSettings] = useState(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    callrail_api_key: '',
    callrail_account_id: '',
    openai_api_key: '',
    sales_tips_prompt: DEFAULT_SALES_TIPS,
  })
  const [showKey, setShowKey] = useState({ callrail: false, openai: false })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState(null)

  // CSV metadata (persisted across page reloads via localStorage)
  const [csvRowCount, setCsvRowCount] = useState(() => {
    const s = localStorage.getItem('csvRowCount')
    return s ? parseInt(s, 10) : 0
  })
  const [csvUploadedAt, setCsvUploadedAt] = useState(() =>
    localStorage.getItem('csvUploadedAt') || null
  )

  // Are API keys configured?
  const keysConfigured = !!(
    userSettings?.callrail_api_key &&
    userSettings?.callrail_account_id &&
    userSettings?.openai_api_key
  )

  // Auth header for every serverless call
  const authHeader = () => ({ Authorization: `Bearer ${session.access_token}` })

  // --- Load existing calls + settings on mount ---
  useEffect(() => {
    loadCalls()
    loadSettings()
  }, [])

  async function loadCalls() {
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .order('call_date', { ascending: false })
      .limit(500)
    if (!error) setCalls(data || [])
  }

  async function loadSettings() {
    const { data } = await supabase
      .from('user_settings')
      .select('*')
      .single()

    if (data) {
      setUserSettings(data)
      setSettingsForm({
        callrail_api_key: data.callrail_api_key || '',
        callrail_account_id: data.callrail_account_id || '',
        openai_api_key: data.openai_api_key || '',
        sales_tips_prompt: data.sales_tips_prompt || DEFAULT_SALES_TIPS,
      })
    } else {
      // First time — open settings automatically
      setSettingsOpen(true)
    }
    setSettingsLoaded(true)
  }

  async function saveSettings() {
    setSettingsSaving(true)
    setSettingsError(null)
    const { error } = await supabase.from('user_settings').upsert({
      user_id: session.user.id,
      callrail_api_key: settingsForm.callrail_api_key.trim(),
      callrail_account_id: settingsForm.callrail_account_id.trim(),
      openai_api_key: settingsForm.openai_api_key.trim(),
      sales_tips_prompt: settingsForm.sales_tips_prompt,
    }, { onConflict: 'user_id' })
    if (!error) {
      await loadSettings()
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 3000)
      if (settingsForm.callrail_api_key && settingsForm.callrail_account_id && settingsForm.openai_api_key) {
        setSettingsOpen(false)
      }
    } else {
      setSettingsError('Save failed: ' + error.message)
    }
    setSettingsSaving(false)
  }

  // --- CSV job data ---
  function handleCSVLoaded({ jobMap, rowCount }) {
    setJobMap(jobMap)
    setCsvRowCount(rowCount || 0)
    const now = new Date().toISOString()
    setCsvUploadedAt(now)
    localStorage.setItem('csvUploadedAt', now)
    localStorage.setItem('csvRowCount', String(rowCount || 0))
  }
  function handleCSVClear() {
    setJobMap(null)
    setCsvRowCount(0)
    setCsvUploadedAt(null)
    localStorage.removeItem('csvUploadedAt')
    localStorage.removeItem('csvRowCount')
  }

  // --- API call wrapper that includes auth header ---
  async function apiFetch(path, options = {}) {
    const res = await fetch(API(path), {
      ...options,
      headers: { ...options.headers, ...authHeader() },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  // --- Main pipeline ---
  async function handleFetchCalls() {
    if (processingRef.current) return
    processingRef.current = true
    setFetchStatus('fetching')
    setFetchMessage('Fetching calls from CallRail…')

    try {
      const { calls: rawCalls } = await apiFetch(
        `callrail-fetch?start=${dateRange.start}&end=${dateRange.end}`
      )

      const eligible = rawCalls.filter(c => c.duration >= 60 && c.recording)
      setFetchMessage(`${eligible.length} eligible calls found. Saving…`)

      if (eligible.length === 0) {
        setFetchStatus('done')
        setFetchMessage('No new calls with recordings ≥60s in this range.')
        processingRef.current = false
        return
      }

      const rows = eligible.map(call => {
        const phone = normalizePhone(call.customer_phone_number)
        const jobData = jobMap?.get(phone) || {}
        const callLink = call.recording_player || `https://app.callrail.com/calls/${call.id}`
        return {
          user_id: session.user.id,
          callrail_id: call.id,
          caller_number: call.customer_phone_number,
          call_date: call.start_time,
          duration_seconds: call.duration,
          source: call.source_name || call.source || null,
          recording_url: callLink,
          job_id: jobData.jobId || null,
          job_type: jobData.jobType || null,
          job_status: jobData.jobStatus || null,
          // Attribution / PPC fields from CallRail
          utm_source: call.utm_source || null,
          utm_medium: call.utm_medium || null,
          utm_campaign: call.utm_campaign || null,
          utm_term: call.utm_term || null,
          gclid: call.gclid || null,
          landing_page_url: call.landing_page_url || null,
          referring_url: call.referring_url || null,
          analysis_status: 'pending',
        }
      })

      const { data: upserted, error: upsertErr } = await supabase
        .from('calls')
        .upsert(rows, { onConflict: 'user_id,callrail_id', ignoreDuplicates: false })
        .select()

      if (upsertErr) throw new Error('Supabase upsert failed: ' + upsertErr.message)

      await loadCalls()

      const toAnalyze = upserted?.filter(c => c.analysis_status === 'pending') || []
      if (toAnalyze.length === 0) {
        setFetchStatus('done')
        setFetchMessage('All calls already analyzed.')
        processingRef.current = false
        return
      }

      setFetchStatus('processing')
      setFetchMessage(`Analyzing ${toAnalyze.length} call${toAnalyze.length === 1 ? '' : 's'}…`)

      let done = 0
      for (const call of toAnalyze) {
        try {
          await analyzeCallStandard(call)
          done++
          setFetchMessage(`Analyzed ${done} / ${toAnalyze.length}…`)
        } catch {
          await supabase.from('calls').update({ analysis_status: 'error' }).eq('id', call.id)
        }
        await loadCalls()
      }

      setFetchStatus('done')
      setFetchMessage(`Done — ${done} call${done === 1 ? '' : 's'} analyzed.`)
    } catch (err) {
      setFetchStatus('error')
      setFetchMessage(err.message)
    } finally {
      processingRef.current = false
    }
  }

  async function analyzeCallStandard(call) {
    await supabase.from('calls').update({ analysis_status: 'processing' }).eq('id', call.id)

    const { audioUrl } = await apiFetch(`callrail-call?callId=${call.callrail_id}`)

    const { transcript } = await apiFetch('openai-transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl }),
    })

    const { analysis } = await apiFetch('openai-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    })

    await supabase.from('calls').update({
      transcript,
      handler_name: analysis.handlerName || null,
      viable_lead: analysis.viableLead || null,
      introduced: analysis.introduced ?? null,
      scheduled: analysis.scheduled ?? null,
      cb_requested: analysis.cbRequested ?? null,
      notes: analysis.notes || null,
      sales_tips: analysis.salesTips || null,
      is_ppc: analysis.isPpc ?? null,
      was_booked: analysis.wasBooked ?? null,
      sentiment: analysis.sentiment || null,
      sentiment_score: analysis.sentimentScore ?? null,
      coaching_tips: analysis.coachingTips || [],
      missed_flags: analysis.missedFlags || [],
      analysis_status: 'complete',
      analysis_tier: 'standard',
    }).eq('id', call.id)
  }

  const handleDeepAnalyze = useCallback(async (call) => {
    setCalls(prev => prev.map(c =>
      c.id === call.id ? { ...c, analysis_status: 'processing' } : c
    ))
    try {
      const { audioUrl } = await apiFetch(`callrail-call?callId=${call.callrail_id}`)
      const { analysis } = await apiFetch('openai-deep-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      })
      const updates = {
        transcript: analysis.transcript || call.transcript || null,
        handler_name: analysis.handlerName || call.handler_name || null,
        viable_lead: analysis.viableLead || call.viable_lead || null,
        introduced: analysis.introduced ?? call.introduced ?? null,
        scheduled: analysis.scheduled ?? call.scheduled ?? null,
        cb_requested: analysis.cbRequested ?? call.cb_requested ?? null,
        notes: analysis.notes || null,
        sales_tips: analysis.salesTips || null,
        is_ppc: analysis.isPpc ?? call.is_ppc ?? null,
        was_booked: analysis.wasBooked ?? call.was_booked ?? null,
        sentiment: analysis.sentiment || null,
        sentiment_score: analysis.sentimentScore ?? null,
        coaching_tips: analysis.coachingTips || [],
        missed_flags: analysis.missedFlags || [],
        tonal_feedback: analysis.tonalFeedback || null,
        talk_time_ratio: analysis.talkTimeRatio || null,
        analysis_status: 'complete',
        analysis_tier: 'deep',
      }
      await supabase.from('calls').update(updates).eq('id', call.id)
      setCalls(prev => prev.map(c => c.id === call.id ? { ...c, ...updates } : c))
    } catch {
      await supabase.from('calls').update({ analysis_status: 'error' }).eq('id', call.id)
      setCalls(prev => prev.map(c =>
        c.id === call.id ? { ...c, analysis_status: 'error' } : c
      ))
    }
  }, [session.access_token])

  // --- Render ---
  const fetchButtonDisabled = !keysConfigured || fetchStatus === 'fetching' || fetchStatus === 'processing'

  if (!settingsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <span className="font-bold text-gray-900 text-sm">Call Analyzer</span>
            <span className="text-gray-300 text-xs">|</span>
            <span className="text-xs text-gray-500">{session.user.email}</span>
          </div>
          <div className="flex items-center gap-2">
            {!keysConfigured && (
              <span className="text-xs text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                ⚠ API keys required
              </span>
            )}
            <button
              onClick={() => setSettingsOpen(v => !v)}
              className={`text-xs px-2 py-1 rounded hover:bg-gray-100 ${
                !keysConfigured ? 'text-amber-700 font-semibold' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              ⚙ Settings
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Settings panel */}
        {settingsOpen && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
              {keysConfigured && (
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  ✕ Close
                </button>
              )}
            </div>

            {/* API Keys section */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">API Keys</h3>
              <p className="text-xs text-gray-500">
                Your keys are stored securely in your account and used server-side only — they are never exposed to the browser after saving.
              </p>

              {/* CallRail API Key */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">CallRail API Key</label>
                <div className="relative">
                  <input
                    type={showKey.callrail ? 'text' : 'password'}
                    value={settingsForm.callrail_api_key}
                    onChange={e => setSettingsForm(f => ({ ...f, callrail_api_key: e.target.value }))}
                    placeholder="Enter your CallRail API key"
                    className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(k => ({ ...k, callrail: !k.callrail }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700"
                  >
                    {showKey.callrail ? 'Hide' : 'Show'}
                  </button>
                </div>
                {userSettings?.callrail_api_key && (
                  <p className="mt-1 text-xs text-gray-400">Currently saved: {maskKey(userSettings.callrail_api_key)}</p>
                )}
              </div>

              {/* CallRail Account ID */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">CallRail Account ID</label>
                <input
                  type="text"
                  value={settingsForm.callrail_account_id}
                  onChange={e => setSettingsForm(f => ({ ...f, callrail_account_id: e.target.value }))}
                  placeholder="e.g. 123456789"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  CallRail → Settings → API → Account ID
                </p>
              </div>

              {/* OpenAI API Key */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">OpenAI API Key</label>
                <div className="relative">
                  <input
                    type={showKey.openai ? 'text' : 'password'}
                    value={settingsForm.openai_api_key}
                    onChange={e => setSettingsForm(f => ({ ...f, openai_api_key: e.target.value }))}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(k => ({ ...k, openai: !k.openai }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700"
                  >
                    {showKey.openai ? 'Hide' : 'Show'}
                  </button>
                </div>
                {userSettings?.openai_api_key && (
                  <p className="mt-1 text-xs text-gray-400">Currently saved: {maskKey(userSettings.openai_api_key)}</p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  One key covers both Whisper transcription and GPT-4o analysis.
                </p>
              </div>
            </div>

            {/* Sales tips prompt */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sales Tips Prompt</h3>
              <p className="text-xs text-gray-500">
                Customize what the AI focuses on when generating sales tips.
              </p>
              <textarea
                value={settingsForm.sales_tips_prompt}
                onChange={e => setSettingsForm(f => ({ ...f, sales_tips_prompt: e.target.value }))}
                rows={6}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3 justify-end pt-1">
              {settingsError && <span className="text-xs text-red-600">{settingsError}</span>}
              {settingsSaved && <span className="text-xs text-green-600">✓ Saved</span>}
              <button
                onClick={saveSettings}
                disabled={settingsSaving}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 font-medium"
              >
                {settingsSaving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}

        {/* First-time setup nudge */}
        {!keysConfigured && !settingsOpen && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-800 mb-1">API keys required before fetching calls</p>
            <p className="text-xs text-amber-600 mb-4">Add your CallRail and OpenAI credentials in Settings.</p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-4 py-2 text-sm rounded-lg bg-amber-700 text-white hover:bg-amber-800"
            >
              Open Settings
            </button>
          </div>
        )}

        {/* Control bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Step 1 — Job Data (optional)
            </h2>
            <CSVUploader
              jobMap={jobMap}
              uploadedAt={csvUploadedAt}
              rowCount={csvRowCount}
              onLoaded={handleCSVLoaded}
              onClear={handleCSVClear}
            />
          </div>

          <div className="border-t border-gray-100" />

          <div>
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Step 2 — Fetch &amp; Analyze Calls
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <DateRangePicker
                start={dateRange.start}
                end={dateRange.end}
                onChange={setDateRange}
              />
              <button
                onClick={handleFetchCalls}
                disabled={fetchButtonDisabled}
                title={!keysConfigured ? 'Configure API keys in Settings first' : ''}
                className="px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {fetchStatus === 'fetching' || fetchStatus === 'processing' ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Working…
                  </>
                ) : (
                  'Fetch Calls'
                )}
              </button>
            </div>

            {fetchMessage && (
              <div className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
                fetchStatus === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : fetchStatus === 'done'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}>
                {fetchMessage}
              </div>
            )}
          </div>
        </div>

        {/* Call list */}
        {calls.length > 0 ? (
          <CallList calls={calls} onDeepAnalyze={handleDeepAnalyze} />
        ) : (
          <div className="text-center py-20 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <p className="text-sm">No calls yet. Upload a job CSV then fetch calls to get started.</p>
          </div>
        )}
      </main>
    </div>
  )
}
