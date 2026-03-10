import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { normalizePhone } from '../lib/phoneNormalize'
import CSVUploader from '../components/CSVUploader'
import DateRangePicker from '../components/DateRangePicker'
import CallList from '../components/CallList'

const API = (path) => `/.netlify/functions/${path}`

const DEFAULT_SALES_TIPS = `Evaluate this call against the four critical sales goals below. Be direct, specific, and actionable — reference exact words or moments from the call where possible.

1. BOOK THE APPOINTMENT — Did the handler ask confidently for the inspection? Was a date and time secured, or did the call end with no committed next step? Was any urgency communicated?

2. ELIMINATE COMPARISON SHOPPING — Did the handler give the caller enough confidence and differentiation to stop them from calling competitors? Were expertise, response time, or insurance experience used as trust-builders? Was any urgency created around acting quickly?

3. CONTROL THE FUTURE STATE — Did the handler walk the caller through what happens next — the inspection, the process, insurance coordination, timeline? Did the caller leave feeling mentally committed and confident in this company?

4. CLOSE TODAY — Was there a direct close attempt before the call ended? If the appointment was not booked, identify the specific moment the sale was lost and write the exact words the handler should have said instead.

Finish with: What was the single most important missed opportunity, and what should the handler have said?`

// --- Helpers ---
function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
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

  // Meta Analysis modal
  const [metaOpen, setMetaOpen] = useState(false)
  const [metaDateMode, setMetaDateMode] = useState('all')  // 'all' | 'range'
  const [metaStart, setMetaStart] = useState(daysAgo(90))
  const [metaEnd, setMetaEnd] = useState(today())
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaResult, setMetaResult] = useState(null)
  const [metaError, setMetaError] = useState(null)

  const processingRef = useRef(false)
  const hasAutoFetched = useRef(false)

  // Settings state
  const [userSettings, setUserSettings] = useState(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    callrail_api_key:    '',
    callrail_account_id: '',
    openai_api_key:      '',
    sales_tips_prompt:   DEFAULT_SALES_TIPS,
  })
  const [showKey, setShowKey] = useState({ callrail: false, openai: false })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState(null)

  // Company membership — loaded from company_members table
  // { companyId, companyName, role: 'admin' | 'member' } | null
  const [membership, setMembership] = useState(null)
  // True if this user is in the super_admins table (cross-company management)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Team management (admin only)
  const [teamMembers, setTeamMembers] = useState([])        // regular admin: flat list
  const [allCompanies, setAllCompanies] = useState([])      // super admin: [{ id, name, members }]
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamError, setTeamError] = useState(null)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserCompanyId, setNewUserCompanyId] = useState('')   // super admin only
  const [newUserCompanyName, setNewUserCompanyName] = useState('') // super admin: new company name
  const [newUserRole, setNewUserRole] = useState('member')         // super admin only
  const [addMode, setAddMode] = useState('new')             // 'new' | 'existing'
  const [addingUser, setAddingUser] = useState(false)
  const [addUserError, setAddUserError] = useState(null)
  const [addUserSuccess, setAddUserSuccess] = useState(null)
  const [removingUserId, setRemovingUserId] = useState(null)

  // Change password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState(null)

  // Auto-fetch on login (localStorage, user-controlled)
  const [autoFetch, setAutoFetch] = useState(() =>
    localStorage.getItem('autoFetchOnLogin') === 'true'
  )
  const [showFetchPrompt, setShowFetchPrompt] = useState(false)

  // CSV metadata (persisted across page reloads via localStorage)
  const [csvRowCount, setCsvRowCount] = useState(() => {
    const s = localStorage.getItem('csvRowCount')
    return s ? parseInt(s, 10) : 0
  })
  const [csvUploadedAt, setCsvUploadedAt] = useState(() =>
    localStorage.getItem('csvUploadedAt') || null
  )
  const [csvMatchMessage, setCsvMatchMessage] = useState(null)

  // Derived
  const keysConfigured = !!(
    userSettings?.callrail_api_key &&
    userSettings?.callrail_account_id &&
    userSettings?.openai_api_key
  )
  const companyName = membership?.companyName || null
  const isAdmin = membership?.role === 'admin' || isSuperAdmin

  const authHeader = () => ({ Authorization: `Bearer ${session.access_token}` })

  // --- Load on mount ---
  useEffect(() => {
    loadCalls()
    loadSettings()
    loadMembership()
  }, [])

  // Load team members once we know the user is an admin or super admin
  useEffect(() => {
    if (membership?.role === 'admin' || isSuperAdmin) {
      loadTeamMembers()
    }
  }, [membership?.role, isSuperAdmin])

  async function loadCalls() {
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .order('call_date', { ascending: false })
      .limit(500)
    if (!error) setCalls(data || [])
  }

  // Loads company membership + super admin status in parallel.
  // Both tables use RLS so each user can only read their own row.
  async function loadMembership() {
    const [memberResult, saResult] = await Promise.all([
      supabase
        .from('company_members')
        .select('role, company_id, companies(name)')
        .eq('user_id', session.user.id)
        .single(),
      supabase
        .from('super_admins')
        .select('user_id')
        .eq('user_id', session.user.id)
        .single(),
    ])

    if (memberResult.data) {
      setMembership({
        companyId:   memberResult.data.company_id,
        companyName: memberResult.data.companies?.name || null,
        role:        memberResult.data.role,
      })
    }

    if (saResult.data) {
      setIsSuperAdmin(true)
    }
  }

  async function loadSettings() {
    const { data } = await supabase
      .from('user_settings')
      .select('*')
      .single()

    if (data) {
      setUserSettings(data)
      setSettingsForm({
        callrail_api_key:    data.callrail_api_key    || '',
        callrail_account_id: data.callrail_account_id || '',
        openai_api_key:      data.openai_api_key      || '',
        sales_tips_prompt:   data.sales_tips_prompt   || DEFAULT_SALES_TIPS,
      })
    } else {
      setSettingsOpen(true)
    }
    setSettingsLoaded(true)
  }

  async function loadTeamMembers() {
    setTeamLoading(true)
    setTeamError(null)
    try {
      const res = await fetch(API('admin-list-users'), { headers: authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.isSuperAdmin) {
        setIsSuperAdmin(true)
        setAllCompanies(data.companies || [])
      } else {
        setTeamMembers(data.members || [])
      }
    } catch (err) {
      setTeamError(err.message)
    } finally {
      setTeamLoading(false)
    }
  }

  async function runMetaAnalysis() {
    setMetaLoading(true)
    setMetaError(null)
    setMetaResult(null)
    try {
      const body = metaDateMode === 'range'
        ? { startDate: metaStart, endDate: metaEnd }
        : {}
      const res = await fetch(API('openai-meta-analyze'), {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMetaResult(data)
    } catch (err) {
      setMetaError(err.message)
    } finally {
      setMetaLoading(false)
    }
  }

  // Auto-fetch trigger: once after settings load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!settingsLoaded || hasAutoFetched.current) return
    if (!keysConfigured) return
    if (autoFetch) {
      hasAutoFetched.current = true
      setShowFetchPrompt(false)
      handleFetchCalls()
    } else {
      setShowFetchPrompt(true)
    }
  }, [settingsLoaded, keysConfigured])

  async function saveSettings() {
    setSettingsSaving(true)
    setSettingsError(null)

    const { error } = await supabase.from('user_settings').upsert({
      user_id:             session.user.id,
      callrail_api_key:    settingsForm.callrail_api_key.trim(),
      callrail_account_id: settingsForm.callrail_account_id.trim(),
      openai_api_key:      settingsForm.openai_api_key.trim(),
      sales_tips_prompt:   settingsForm.sales_tips_prompt,
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

  async function changePassword() {
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return }
    setPasswordSaving(true)
    setPasswordError(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError(error.message)
    } else {
      setPasswordSaved(true)
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSaved(false), 3000)
    }
    setPasswordSaving(false)
  }

  async function addTeamMember() {
    if (!newUserEmail.trim()) {
      setAddUserError('Email is required.')
      return
    }
    if (addMode === 'new' && !newUserPassword.trim()) {
      setAddUserError('Password is required for new users.')
      return
    }
    if (isSuperAdmin) {
      if (!newUserCompanyId) { setAddUserError('Select a company for this user.'); return }
      if (newUserCompanyId === 'new' && !newUserCompanyName.trim()) {
        setAddUserError('Enter a name for the new company.'); return
      }
    }
    setAddingUser(true)
    setAddUserError(null)
    setAddUserSuccess(null)
    try {
      const body = { email: newUserEmail.trim() }
      if (addMode === 'new') body.password = newUserPassword.trim()
      if (isSuperAdmin) {
        body.role = newUserRole
        if (newUserCompanyId === 'new') {
          body.newCompanyName = newUserCompanyName.trim()
        } else {
          body.companyId = newUserCompanyId
        }
      }
      const endpoint = addMode === 'existing' ? 'admin-add-existing-user' : 'admin-create-user'
      const res = await fetch(API(endpoint), {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const destName = isSuperAdmin
        ? (newUserCompanyId === 'new'
            ? newUserCompanyName.trim()
            : allCompanies.find(c => c.id === newUserCompanyId)?.name || 'the company')
        : (companyName || 'your team')
      setAddUserSuccess(`✓ ${newUserEmail.trim()} added to ${destName}`)
      setNewUserEmail('')
      setNewUserPassword('')
      setNewUserCompanyId('')
      setNewUserCompanyName('')
      setNewUserRole('member')
      await loadTeamMembers()
    } catch (err) {
      setAddUserError(err.message)
    } finally {
      setAddingUser(false)
    }
  }

  // Removes a user from a company. Super admin passes companyId explicitly.
  async function removeTeamMember(userId, targetCompanyId) {
    if (!window.confirm('Remove this user from the company?\n\nTheir account and call history are preserved — they just lose access.')) return
    setRemovingUserId(userId)
    try {
      const body = isSuperAdmin ? { userId, companyId: targetCompanyId } : { userId }
      const res = await fetch(API('admin-remove-user'), {
        method: 'DELETE',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await loadTeamMembers()
    } catch (err) {
      setTeamError(err.message)
    } finally {
      setRemovingUserId(null)
    }
  }

  function toggleAutoFetch(val) {
    setAutoFetch(val)
    localStorage.setItem('autoFetchOnLogin', String(val))
  }

  // --- Retroactively match all existing DB calls against newly uploaded CSV ---
  async function retroactivelyMatchCSV(newJobMap) {
    const { data: existingCalls, error } = await supabase
      .from('calls')
      .select('id, caller_number')
    if (error || !existingCalls?.length) return 0

    const toUpdate = existingCalls
      .map(call => {
        const phone = normalizePhone(call.caller_number)
        const jobData = newJobMap.get(phone)
        if (!jobData) return null
        return { id: call.id, jobData }
      })
      .filter(Boolean)

    if (!toUpdate.length) return 0

    const BATCH = 10
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      await Promise.all(
        toUpdate.slice(i, i + BATCH).map(({ id, jobData }) =>
          supabase.from('calls').update({
            job_id:        jobData.jobId        || null,
            job_type:      jobData.jobType      || null,
            job_status:    jobData.jobStatus    || null,
            customer_name: jobData.customerName || null,
            albi_url:      jobData.albiUrl      || null,
            contract_signed: jobData.contractSigned || null,
          }).eq('id', id)
        )
      )
    }
    return toUpdate.length
  }

  // --- CSV job data ---
  async function handleCSVLoaded({ jobMap: newJobMap, rowCount }) {
    setJobMap(newJobMap)
    setCsvRowCount(rowCount || 0)
    const now = new Date().toISOString()
    setCsvUploadedAt(now)
    localStorage.setItem('csvUploadedAt', now)
    localStorage.setItem('csvRowCount', String(rowCount || 0))

    setCsvMatchMessage('Matching existing calls with Albi data…')
    const matched = await retroactivelyMatchCSV(newJobMap)
    setCsvMatchMessage(
      matched > 0
        ? `✓ Matched ${matched} existing call${matched === 1 ? '' : 's'} with Albi data`
        : 'No existing calls matched Albi records'
    )
    setTimeout(() => setCsvMatchMessage(null), 6000)
    await loadCalls()
  }

  function handleCSVClear() {
    setJobMap(null)
    setCsvRowCount(0)
    setCsvUploadedAt(null)
    setCsvMatchMessage(null)
    localStorage.removeItem('csvUploadedAt')
    localStorage.removeItem('csvRowCount')
  }

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
    setShowFetchPrompt(false)

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
          user_id:          session.user.id,
          company_id:       membership?.companyId || null,
          callrail_id:      call.id,
          caller_number:    call.customer_phone_number,
          call_date:        call.start_time,
          duration_seconds: call.duration,
          source:           call.source_name || call.source || null,
          recording_url:    callLink,
          job_id:           jobData.jobId        || null,
          job_type:         jobData.jobType      || null,
          job_status:       jobData.jobStatus    || null,
          customer_name:    jobData.customerName || null,
          albi_url:         jobData.albiUrl      || null,
          contract_signed:  jobData.contractSigned || null,
          utm_source:       call.utm_source       || null,
          utm_medium:       call.utm_medium       || null,
          utm_campaign:     call.utm_campaign     || null,
          utm_term:         call.utm_term         || null,
          gclid:            call.gclid            || null,
          landing_page_url: call.landing_page_url || null,
          referring_url:    call.referring_url    || null,
          analysis_status:  'pending',
        }
      })

      // ignoreDuplicates: true — skip calls that already exist in the DB entirely.
      // Prevents re-analyzing calls that are already complete or deep-analyzed.
      const { data: upserted, error: upsertErr } = await supabase
        .from('calls')
        .upsert(rows, { onConflict: 'user_id,callrail_id', ignoreDuplicates: true })
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
      handler_name:   analysis.handlerName   || null,
      viable_lead:    analysis.viableLead    || null,
      introduced:     analysis.introduced    ?? null,
      scheduled:      analysis.scheduled     ?? null,
      cb_requested:   analysis.cbRequested   ?? null,
      notes:          analysis.notes         || null,
      sales_tips:     analysis.salesTips     || null,
      is_ppc:         analysis.isPpc         ?? null,
      was_booked:     analysis.wasBooked     ?? null,
      sentiment:      analysis.sentiment     || null,
      sentiment_score: analysis.sentimentScore ?? null,
      coaching_tips:  analysis.coachingTips  || [],
      missed_flags:   analysis.missedFlags   || [],
      analysis_status: 'complete',
      analysis_tier:   'standard',
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
        transcript:      analysis.transcript      || call.transcript      || null,
        handler_name:    analysis.handlerName     || call.handler_name    || null,
        viable_lead:     analysis.viableLead      || call.viable_lead     || null,
        introduced:      analysis.introduced      ?? call.introduced      ?? null,
        scheduled:       analysis.scheduled       ?? call.scheduled       ?? null,
        cb_requested:    analysis.cbRequested     ?? call.cb_requested    ?? null,
        notes:           analysis.notes           || null,
        sales_tips:      analysis.salesTips       || null,
        is_ppc:          analysis.isPpc           ?? call.is_ppc          ?? null,
        was_booked:      analysis.wasBooked       ?? call.was_booked      ?? null,
        sentiment:       analysis.sentiment       || null,
        sentiment_score: analysis.sentimentScore  ?? null,
        coaching_tips:   analysis.coachingTips    || [],
        missed_flags:    analysis.missedFlags     || [],
        tonal_feedback:  analysis.tonalFeedback   || null,
        talk_time_ratio: analysis.talkTimeRatio   || null,
        analysis_status: 'complete',
        analysis_tier:   'deep',
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
            {companyName && (
              <>
                <span className="text-gray-300 text-xs">|</span>
                <span className="text-xs font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                  {companyName}
                </span>
              </>
            )}
            <span className="text-gray-300 text-xs">|</span>
            <span className="text-xs text-gray-500">{session.user.email}</span>
            {isSuperAdmin ? (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                Super Admin
              </span>
            ) : isAdmin ? (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                Admin
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {!keysConfigured && (
              <span className="text-xs text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                ⚠ API keys required
              </span>
            )}
            {keysConfigured && (
              <button
                onClick={() => { setMetaOpen(true); setMetaResult(null); setMetaError(null) }}
                className="text-xs px-2 py-1 rounded hover:bg-gray-100 text-indigo-600 hover:text-indigo-800 font-medium"
              >
                ✦ Meta Analysis
              </button>
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

      {/* ── Meta Analysis Modal ─────────────────────────────── */}
      {metaOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 px-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">✦ Meta Analysis</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  AI-powered trends across all analyzed viable calls — ranked by impact on bookings
                </p>
              </div>
              <button onClick={() => setMetaOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
            </div>

            {/* Controls */}
            {!metaResult && !metaLoading && (
              <div className="px-6 py-5 space-y-4">
                {/* Date mode toggle */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Calls to include</label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-300 text-sm w-fit">
                    <button
                      onClick={() => setMetaDateMode('all')}
                      className={`px-4 py-2 font-medium transition-colors ${metaDateMode === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      All Historic Calls
                    </button>
                    <button
                      onClick={() => setMetaDateMode('range')}
                      className={`px-4 py-2 font-medium transition-colors ${metaDateMode === 'range' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Date Range
                    </button>
                  </div>
                </div>

                {metaDateMode === 'range' && (
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">From</label>
                      <input type="date" value={metaStart} onChange={e => setMetaStart(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">To</label>
                      <input type="date" value={metaEnd} onChange={e => setMetaEnd(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                  </div>
                )}

                {metaError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{metaError}</p>
                )}

                <button
                  onClick={runMetaAnalysis}
                  className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Run Analysis
                </button>
              </div>
            )}

            {/* Loading */}
            {metaLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-gray-500">
                <svg className="animate-spin w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm">Analyzing calls… this may take 20–40 seconds</p>
              </div>
            )}

            {/* Results */}
            {metaResult && !metaLoading && (
              <div className="overflow-y-auto px-6 py-5 space-y-5">

                {/* Stats bar */}
                <div className="flex items-center gap-6 bg-indigo-50 rounded-xl px-4 py-3 text-sm">
                  <span className="text-indigo-700 font-semibold">{metaResult.callCount} viable calls analyzed</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-700">{metaResult.bookedRate || `${metaResult.bookedCount} booked`}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500 text-xs capitalize">{metaResult.period}</span>
                </div>

                {/* Executive summary */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Executive Summary</p>
                  <p className="text-sm text-gray-800 leading-relaxed">{metaResult.summary}</p>
                </div>

                {/* Quick win */}
                {metaResult.quickWin && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">⚡ Quick Win — Implement Tomorrow</p>
                    <p className="text-sm text-green-900 leading-relaxed">{metaResult.quickWin}</p>
                  </div>
                )}

                {/* 5 Priorities */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Top 5 Training Priorities</p>
                  {metaResult.priorities?.map(p => (
                    <div key={p.rank} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 bg-indigo-600 px-4 py-2.5">
                        <span className="text-white font-bold text-lg leading-none">#{p.rank}</span>
                        <span className="text-white font-semibold text-sm">{p.title}</span>
                      </div>
                      <div className="p-4 space-y-3 text-sm">
                        <div>
                          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">The Problem</p>
                          <p className="text-gray-800 leading-relaxed">{p.problem}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Evidence from Calls</p>
                          <p className="text-gray-700 leading-relaxed">{p.evidence}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">What to Train</p>
                          <p className="text-gray-800 leading-relaxed">{p.training}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Expected Impact</p>
                          <p className="text-gray-700 leading-relaxed">{p.impact}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => { setMetaResult(null); setMetaError(null) }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  ← Run another analysis
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Settings panel ──────────────────────────────────── */}
        {settingsOpen && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
              {keysConfigured && (
                <button onClick={() => setSettingsOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">
                  ✕ Close
                </button>
              )}
            </div>

            {/* API Keys */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">API Keys</h3>
              <p className="text-xs text-gray-500">
                Your keys are stored securely and used server-side only — they are never exposed to the browser after saving.
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
                    className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button type="button" onClick={() => setShowKey(k => ({ ...k, callrail: !k.callrail }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700">
                    {showKey.callrail ? 'Hide' : 'Show'}
                  </button>
                </div>
                {userSettings?.callrail_api_key && (
                  <p className="mt-1 text-xs text-gray-400">Saved: {maskKey(userSettings.callrail_api_key)}</p>
                )}
                <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-xs font-medium text-gray-600">How to find your CallRail API Key:</p>
                  <ol className="text-xs text-gray-500 list-decimal list-inside space-y-0.5 mt-1">
                    <li>
                      Log in to{' '}
                      <a href="https://sociusmarketing.callreports.com/authenticate/" target="_blank" rel="noreferrer"
                        className="text-brand-600 hover:underline">sociusmarketing.callreports.com</a>
                    </li>
                    <li>Click <strong>Integrations</strong> in the left sidebar</li>
                    <li>Click <strong>Create API V3 Key</strong></li>
                    <li>Copy and paste the key above — <strong>it's only visible for 15 minutes</strong></li>
                  </ol>
                </div>
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
                <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-xs font-medium text-gray-600">How to find your Account ID:</p>
                  <p className="text-xs text-gray-500 mt-1">
                    While logged in, look at the URL in your browser. Your Account ID is the
                    number after <code className="bg-gray-100 px-1 rounded">/a/</code> — for example:<br />
                    <span className="font-mono text-gray-600">sociusmarketing.callreports.com/analytics/a/<strong className="text-brand-700">123456789</strong>/</span>
                  </p>
                </div>
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
                    className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button type="button" onClick={() => setShowKey(k => ({ ...k, openai: !k.openai }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700">
                    {showKey.openai ? 'Hide' : 'Show'}
                  </button>
                </div>
                {userSettings?.openai_api_key && (
                  <p className="mt-1 text-xs text-gray-400">Saved: {maskKey(userSettings.openai_api_key)}</p>
                )}
                <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-xs font-medium text-gray-600">How to get your OpenAI API Key:</p>
                  <ol className="text-xs text-gray-500 list-decimal list-inside space-y-0.5 mt-1">
                    <li>
                      Visit{' '}
                      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer"
                        className="text-brand-600 hover:underline">platform.openai.com/api-keys</a>
                    </li>
                    <li>Log in (create an account if needed)</li>
                    <li>Click <strong>+ Create new secret key</strong>, give it a name, click <strong>Create secret key</strong></li>
                    <li>Copy the key and paste it above — it won't be shown again</li>
                    <li>Go to <strong>Billing</strong> and add a credit card. $10 covers hundreds of calls.</li>
                  </ol>
                  <p className="text-xs text-gray-400 mt-1.5 border-t border-gray-200 pt-1.5">
                    Standard analysis: ~$0.007/min · Deep tonal analysis: ~$0.04–$0.06/min
                  </p>
                </div>
              </div>
            </div>

            {/* Sales tips prompt */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sales Tips Prompt</h3>
              <p className="text-xs text-gray-500">Customize what the AI focuses on when generating sales tips.</p>
              <textarea
                value={settingsForm.sales_tips_prompt}
                onChange={e => setSettingsForm(f => ({ ...f, sales_tips_prompt: e.target.value }))}
                rows={6}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Auto-fetch toggle */}
            <div className="pt-2 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Fetch Behavior</h3>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input type="checkbox" className="sr-only" checked={autoFetch}
                    onChange={e => toggleAutoFetch(e.target.checked)} />
                  <div className={`w-9 h-5 rounded-full transition-colors ${autoFetch ? 'bg-brand-600' : 'bg-gray-300'}`} />
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoFetch ? 'translate-x-4' : ''}`} />
                </div>
                <div>
                  <p className="text-sm text-gray-800 font-medium">Auto-fetch calls on login</p>
                  <p className="text-xs text-gray-500">Automatically fetch the last 7 days whenever you sign in</p>
                </div>
              </label>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3 justify-end pt-1 border-t border-gray-100">
              {settingsError && <span className="text-xs text-red-600">{settingsError}</span>}
              {settingsSaved && <span className="text-xs text-green-600">✓ Saved</span>}
              <button onClick={saveSettings} disabled={settingsSaving}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 font-medium">
                {settingsSaving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>

            {/* Change Password */}
            <div className="pt-2 border-t border-gray-100 space-y-3">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Change Password</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">New password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Confirm password</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                {passwordError && <span className="text-xs text-red-600">{passwordError}</span>}
                {passwordSaved && <span className="text-xs text-green-600">✓ Password updated</span>}
                <button onClick={changePassword} disabled={passwordSaving || !newPassword}
                  className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50 font-medium ml-auto">
                  {passwordSaving ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>

            {/* ── Team Management (admin / super admin only) ───────── */}
            {isAdmin && (
              <div className="pt-2 border-t border-gray-100 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Team Management
                  </h3>
                  {isSuperAdmin ? (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                      Super Admin
                    </span>
                  ) : companyName ? (
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                      {companyName}
                    </span>
                  ) : null}
                </div>

                {/* Loading / error state */}
                {teamLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="animate-spin inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full" />
                    Loading team…
                  </div>
                ) : teamError ? (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-red-600 flex-1">{teamError}</p>
                    <button onClick={loadTeamMembers} className="text-xs text-gray-500 hover:text-gray-700 underline">Retry</button>
                  </div>
                ) : isSuperAdmin ? (
                  /* ── Super admin: all companies ── */
                  <div className="space-y-4">
                    {allCompanies.length === 0 && (
                      <p className="text-xs text-gray-400 italic">No companies yet — create one below.</p>
                    )}
                    {allCompanies.map(company => (
                      <div key={company.id} className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="bg-gray-100 px-3 py-2 flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">{company.name}</span>
                          <span className="text-xs text-gray-400">{company.members.length} member{company.members.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {company.members.length === 0 ? (
                            <p className="text-xs text-gray-400 italic px-3 py-2">No members yet.</p>
                          ) : company.members.map(member => (
                            <div key={member.id} className="flex items-center justify-between px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm text-gray-800 truncate">{member.email}</span>
                                {member.isCurrentUser && <span className="text-xs text-gray-400 flex-shrink-0">(you)</span>}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  member.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                                }`}>{member.role}</span>
                                {!member.isCurrentUser && (
                                  <button
                                    onClick={() => removeTeamMember(member.id, company.id)}
                                    disabled={removingUserId === member.id}
                                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                                  >
                                    {removingUserId === member.id ? 'Removing…' : 'Remove'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* ── Regular admin: own company only ── */
                  <div className="space-y-1.5">
                    <p className="text-xs text-gray-500">
                      Users are locked into <strong>{companyName || 'your company'}</strong> and cannot access any other company's data.
                    </p>
                    {teamMembers.map(member => (
                      <div key={member.id}
                        className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-50 border border-gray-100">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-gray-800 truncate">{member.email}</span>
                          {member.isCurrentUser && <span className="text-xs text-gray-400 flex-shrink-0">(you)</span>}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            member.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                          }`}>{member.role}</span>
                          {!member.isCurrentUser && (
                            <button
                              onClick={() => removeTeamMember(member.id, null)}
                              disabled={removingUserId === member.id}
                              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
                            >
                              {removingUserId === member.id ? 'Removing…' : 'Remove'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {teamMembers.length === 0 && (
                      <p className="text-xs text-gray-400 italic py-2">No team members yet — add one below.</p>
                    )}
                  </div>
                )}

                {/* ── Add User form ── */}
                <div className="pt-3 border-t border-gray-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-gray-700">Add Team Member</h4>
                    {/* Toggle: new account vs existing Supabase user */}
                    <div className="flex rounded-lg overflow-hidden border border-gray-300 text-xs">
                      <button
                        onClick={() => { setAddMode('new'); setAddUserError(null); setAddUserSuccess(null) }}
                        className={`px-3 py-1 font-medium transition-colors ${addMode === 'new' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        New account
                      </button>
                      <button
                        onClick={() => { setAddMode('existing'); setAddUserError(null); setAddUserSuccess(null) }}
                        className={`px-3 py-1 font-medium transition-colors ${addMode === 'existing' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Existing user
                      </button>
                    </div>
                  </div>
                  {addMode === 'existing' && (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      Grant access to someone who already has an account on this Supabase project (e.g. registered via another app).
                    </p>
                  )}

                  {/* Super admin extras: company selector + role */}
                  {isSuperAdmin && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Company</label>
                        <select
                          value={newUserCompanyId}
                          onChange={e => { setNewUserCompanyId(e.target.value); setNewUserCompanyName(''); setAddUserError(null) }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <option value="">— Select company —</option>
                          {allCompanies.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                          <option value="new">＋ New company…</option>
                        </select>
                        {newUserCompanyId === 'new' && (
                          <input
                            type="text"
                            value={newUserCompanyName}
                            onChange={e => setNewUserCompanyName(e.target.value)}
                            placeholder="Company name"
                            autoFocus
                            className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
                        <select
                          value={newUserRole}
                          onChange={e => setNewUserRole(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <option value="member">Member — view &amp; analyze calls</option>
                          <option value="admin">Admin — manage their company's team</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Email + password */}
                  <div className={`grid gap-3 ${addMode === 'new' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Email address</label>
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={e => { setNewUserEmail(e.target.value); setAddUserError(null); setAddUserSuccess(null) }}
                        onKeyDown={e => e.key === 'Enter' && addTeamMember()}
                        placeholder="employee@company.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    {addMode === 'new' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Temporary password</label>
                        <input
                          type="text"
                          value={newUserPassword}
                          onChange={e => { setNewUserPassword(e.target.value); setAddUserError(null); setAddUserSuccess(null) }}
                          onKeyDown={e => e.key === 'Enter' && addTeamMember()}
                          placeholder="Min 8 characters"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {addUserError && <span className="text-xs text-red-600 flex-1">{addUserError}</span>}
                    {addUserSuccess && <span className="text-xs text-green-600 flex-1">{addUserSuccess}</span>}
                    <button
                      onClick={addTeamMember}
                      disabled={addingUser || !newUserEmail || (addMode === 'new' && !newUserPassword)}
                      className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-medium ml-auto transition-colors"
                    >
                      {addingUser ? 'Adding…' : addMode === 'existing' ? 'Grant Access' : 'Add User'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* First-time setup nudge */}
        {!keysConfigured && !settingsOpen && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-800 mb-1">API keys required before fetching calls</p>
            <p className="text-xs text-amber-600 mb-4">Add your CallRail and OpenAI credentials in Settings.</p>
            <button onClick={() => setSettingsOpen(true)}
              className="px-4 py-2 text-sm rounded-lg bg-amber-700 text-white hover:bg-amber-800">
              Open Settings
            </button>
          </div>
        )}

        {/* Auto-fetch login prompt */}
        {showFetchPrompt && keysConfigured && !settingsOpen && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-blue-800">Fetch new calls?</p>
              <p className="text-xs text-blue-600 mt-0.5">Last 7 days · {dateRange.start} → {dateRange.end}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => { setShowFetchPrompt(false); handleFetchCalls() }}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                Fetch Calls
              </button>
              <button onClick={() => setShowFetchPrompt(false)} className="text-xs text-blue-500 hover:text-blue-700">
                Dismiss
              </button>
            </div>
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
            {csvMatchMessage && (
              <p className={`mt-2 text-xs px-3 py-1.5 rounded-lg border ${
                csvMatchMessage.startsWith('✓')
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}>
                {csvMatchMessage}
              </p>
            )}
          </div>

          <div className="border-t border-gray-100" />

          <div>
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Step 2 — Fetch &amp; Analyze Calls
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <DateRangePicker start={dateRange.start} end={dateRange.end} onChange={setDateRange} />
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
                ) : 'Fetch Calls'}
              </button>
            </div>
            {fetchMessage && (
              <div className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
                fetchStatus === 'error' ? 'bg-red-50 border-red-200 text-red-700'
                : fetchStatus === 'done' ? 'bg-green-50 border-green-200 text-green-700'
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
