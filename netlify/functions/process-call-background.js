/**
 * Background Function — Transcribe + Analyze a call recording.
 *
 * Runs asynchronously (Netlify returns 202 immediately).
 * Saves results directly to Supabase using the service role key,
 * so it works even if the user's session expires during processing.
 *
 * Body (JSON): { callId: string, audioUrl: string }
 * Header: Authorization: Bearer <supabase_jwt>
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SALES_TIPS_PROMPT = `Evaluate this call against the four critical sales goals below. Be direct, specific, and actionable — reference exact words or moments from the transcript where possible.

1. BOOK THE APPOINTMENT — Did the handler ask confidently for the inspection? Was a date and time secured, or did the call end with no committed next step? Was any urgency communicated?

2. ELIMINATE COMPARISON SHOPPING — Did the handler give the caller enough confidence and differentiation to stop them from calling competitors? Were expertise, response time, or insurance experience used as trust-builders? Was any urgency created around acting quickly?

3. CONTROL THE FUTURE STATE — Did the handler walk the caller through what happens next — the inspection, the process, insurance coordination, timeline? Did the caller leave feeling mentally committed and confident in this company?

4. CLOSE TODAY — Was there a direct close attempt before the call ended? If the appointment was not booked, identify the specific moment the sale was lost and write the exact words the handler should have said instead.

Finish with: What was the single most important missed opportunity, and what should the handler have said?`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let user, settings
  try {
    ;({ user, settings } = await getSettings(event.headers['authorization'], { requireCallRail: false }))
  } catch (err) {
    return json(err.message.startsWith('Unauthorized') ? 401 : 400, { error: err.message })
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const { callId, audioUrl } = body
  if (!callId || !audioUrl) return json(400, { error: 'Missing callId or audioUrl' })

  // Service role client — bypasses RLS for writing results back to DB
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const fail = async (msg) => {
    await supabase.from('calls').update({ analysis_status: 'error' }).eq('id', callId)
    return json(500, { error: msg })
  }

  // 1. Download audio recording
  let audioBuffer
  try {
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) return fail(`Failed to download audio (status ${audioRes.status})`)
    audioBuffer = await audioRes.arrayBuffer()
  } catch (err) {
    return fail('Audio download failed: ' + err.message)
  }

  // 2. Transcribe with Whisper-1
  let transcript
  try {
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3')
    form.append('model', 'whisper-1')
    form.append('response_format', 'text')

    const transcribeRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.openai_api_key}` },
      body: form,
    })

    if (!transcribeRes.ok) {
      const errData = await transcribeRes.json().catch(() => ({}))
      return fail(`Whisper transcription failed: ${errData.error?.message || transcribeRes.status}`)
    }

    transcript = (await transcribeRes.text()).trim()
  } catch (err) {
    return fail('Transcription error: ' + err.message)
  }

  // 3. Analyze transcript with GPT-4o-mini
  const tipsInstructions = settings.sales_tips_prompt || DEFAULT_SALES_TIPS_PROMPT

  const systemPrompt = `You are a Sales Call Analyst for a Restoration company. Analyze the call transcript provided.

Return ONLY valid JSON with these exact fields:
{
  "handlerName": "string — first name of who answered",
  "viableLead": "Yes | No | Unknown",
  "introduced": true/false,
  "scheduled": true/false,
  "cbRequested": true/false,
  "notes": "string — 2-3 sentence summary of the call",
  "salesTips": "string — numbered list answering these questions:\\n${tipsInstructions}",
  "isPpc": true/false,
  "wasBooked": true/false,
  "sentiment": "string — one word: anxious, confident, hesitant, frustrated, satisfied, neutral",
  "sentimentScore": 0-100,
  "coachingTips": ["tip1 — specific, actionable coaching point tied to booking, eliminating comparison shopping, controlling future state, or closing today", "tip2", "tip3"],
  "missedFlags": ["flag1 — specific moment where handler failed to close, invited comparison shopping, or left caller without confidence or a next step", "flag2"]
}

No markdown fences. No extra keys. JSON only.`

  let analysis
  try {
    const analyzeRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openai_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
      }),
    })

    if (!analyzeRes.ok) {
      const errData = await analyzeRes.json().catch(() => ({}))
      return fail(`OpenAI analysis failed: ${errData.error?.message || analyzeRes.status}`)
    }

    const data = await analyzeRes.json()
    analysis = JSON.parse(data.choices?.[0]?.message?.content || '{}')
  } catch (err) {
    return fail('Analysis error: ' + err.message)
  }

  // 4. Save results to Supabase
  const { error: saveErr } = await supabase.from('calls').update({
    transcript,
    handler_name:    analysis.handlerName    || null,
    viable_lead:     analysis.viableLead     || null,
    introduced:      analysis.introduced     ?? null,
    scheduled:       analysis.scheduled      ?? null,
    cb_requested:    analysis.cbRequested    ?? null,
    notes:           analysis.notes          || null,
    sales_tips:      analysis.salesTips      || null,
    is_ppc:          analysis.isPpc          ?? null,
    was_booked:      analysis.wasBooked      ?? null,
    sentiment:       analysis.sentiment      || null,
    sentiment_score: analysis.sentimentScore ?? null,
    coaching_tips:   analysis.coachingTips   || [],
    missed_flags:    analysis.missedFlags    || [],
    analysis_status: 'complete',
    analysis_tier:   'standard',
  }).eq('id', callId)

  if (saveErr) return fail('Failed to save results: ' + saveErr.message)

  return json(200, { success: true })
}
