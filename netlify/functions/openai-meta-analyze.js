/**
 * openai-meta-analyze.js
 *
 * Aggregates all analyzed viable-lead calls for the user's company and sends
 * them to GPT-4o for cross-call trend analysis. Returns the top 5 training
 * priorities most likely to increase bookings immediately.
 *
 * POST /.netlify/functions/openai-meta-analyze
 * Body (JSON): { startDate?: 'YYYY-MM-DD', endDate?: 'YYYY-MM-DD' }
 * Header: Authorization: Bearer <supabase_jwt>
 */

import { createClient } from '@supabase/supabase-js'
import { jsonResponse as json } from './_getSettings.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  // ── Auth ────────────────────────────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization']
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'Server misconfiguration.' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const jwt = authHeader.slice(7)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) return json(401, { error: 'Unauthorized: invalid or expired session.' })

  // ── Get user's OpenAI key and company ───────────────────────
  const [settingsResult, memberResult] = await Promise.all([
    supabase.from('user_settings')
      .select('openai_api_key')
      .eq('user_id', user.id)
      .single(),
    supabase.from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .single(),
  ])

  const openaiKey = settingsResult.data?.openai_api_key
  if (!openaiKey) return json(400, { error: 'OpenAI API key not configured in Settings.' })

  const companyId = memberResult.data?.company_id || null

  // ── Parse body ──────────────────────────────────────────────
  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { /* use defaults */ }
  const { startDate, endDate } = body

  // ── Query viable, fully-analyzed calls ──────────────────────
  let query = supabase
    .from('calls')
    .select('call_date, handler_name, notes, sales_tips, coaching_tips, missed_flags, tonal_feedback, was_booked, sentiment_score, analysis_tier')
    .eq('viable_lead', 'Yes')
    .eq('analysis_status', 'complete')
    .not('notes', 'is', null)
    .order('call_date', { ascending: false })
    .limit(150) // cap to avoid token overflow (~75k tokens max)

  // Company or user isolation
  if (companyId) {
    query = query.eq('company_id', companyId)
  } else {
    query = query.eq('user_id', user.id)
  }

  if (startDate) query = query.gte('call_date', startDate)
  if (endDate)   query = query.lte('call_date', endDate + 'T23:59:59')

  const { data: calls, error: callsErr } = await query
  if (callsErr) return json(500, { error: 'Failed to load calls: ' + callsErr.message })

  if (!calls || calls.length < 3) {
    return json(400, {
      error: `Not enough analyzed calls to find trends. ${calls?.length || 0} viable call${calls?.length === 1 ? '' : 's'} found — need at least 3.`,
    })
  }

  const bookedCount = calls.filter(c => c.was_booked).length
  const period = startDate
    ? `${startDate} to ${endDate || 'present'}`
    : 'all time'

  // ── Format calls into compact prompt blocks ──────────────────
  const callBlocks = calls.map((c, i) => {
    const date = c.call_date ? new Date(c.call_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'
    const handler = c.handler_name || 'Unknown'
    const booked = c.was_booked ? 'YES' : 'NO'
    const score = c.sentiment_score != null ? `${c.sentiment_score}/100` : 'N/A'
    const tier = c.analysis_tier === 'deep' ? ' [deep]' : ''

    const lines = [
      `[Call ${i + 1} | ${date} | Handler: ${handler} | Booked: ${booked} | Sentiment: ${score}${tier}]`,
      c.notes       ? `Summary: ${c.notes}` : null,
      c.sales_tips  ? `Sales Analysis:\n${c.sales_tips}` : null,
      (c.coaching_tips?.length) ? `Coaching Points: ${c.coaching_tips.join(' • ')}` : null,
      (c.missed_flags?.length)  ? `Missed Flags: ${c.missed_flags.join(' • ')}` : null,
      c.tonal_feedback ? `Tone: ${c.tonal_feedback}` : null,
    ].filter(Boolean)

    return lines.join('\n')
  }).join('\n\n---\n\n')

  // ── System prompt ────────────────────────────────────────────
  const systemPrompt = `You are a sales training consultant for a restoration company (water damage, fire, mold). You are reviewing a batch of inbound call analyses to identify the most impactful training opportunities.

Your four core goals are:
1. BOOK THE APPOINTMENT — Get every viable lead committed to an inspection before the call ends
2. ELIMINATE COMPARISON SHOPPING — Make the caller feel no need to call other companies
3. CONTROL THE FUTURE STATE — Walk every caller through what happens next so they feel mentally committed
4. CLOSE TODAY — Secure a commitment on every call, same day

Analyze the call data below and return ONLY valid JSON:
{
  "summary": "string — 2-3 sentence executive summary of the patterns you observed across all calls. Be frank.",
  "quickWin": "string — the single change that would have the biggest immediate impact on bookings if implemented tomorrow",
  "bookedRate": "string — e.g. '12 of 30 viable leads booked (40%)'",
  "priorities": [
    {
      "rank": 1,
      "title": "string — short, punchy title for this training priority",
      "problem": "string — what handlers are consistently doing wrong or missing, with specific pattern",
      "evidence": "string — 2-3 specific examples from the calls that illustrate this problem",
      "training": "string — exactly what to teach and the specific words/phrases handlers should use instead",
      "impact": "string — why fixing this will directly increase bookings or reduce comparison shopping"
    }
  ]
}

Return exactly 5 items in priorities, ranked by expected impact on bookings. No markdown fences. JSON only.`

  const userMessage = `Period: ${period}
Total viable calls analyzed: ${calls.length}
Calls booked: ${bookedCount}

CALL DATA:

${callBlocks}`

  // ── Send to GPT-4o ───────────────────────────────────────────
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    return json(res.status, { error: 'OpenAI API error', details: err })
  }

  const data = await res.json()
  const rawContent = data.choices?.[0]?.message?.content || '{}'

  let analysis
  try {
    analysis = JSON.parse(rawContent)
  } catch {
    return json(500, { error: 'Failed to parse AI response', raw: rawContent })
  }

  return json(200, {
    ...analysis,
    callCount: calls.length,
    bookedCount,
    period,
  })
}
