/**
 * Standard Tier — Step 2: Analyze a transcript with GPT-4o-mini.
 *
 * Body (JSON): { transcript: string, salesTipsPrompt?: string }
 * Header: Authorization: Bearer <supabase_jwt>
 * Returns full analysis JSON matching the reference Apps Script field set.
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'

const DEFAULT_SALES_TIPS_PROMPT = `Evaluate this call against the four critical sales goals below. Be direct, specific, and actionable — reference exact words or moments from the transcript where possible.

1. BOOK THE APPOINTMENT — Did the handler ask confidently for the inspection? Was a date and time secured, or did the call end with no committed next step? Was any urgency communicated?

2. ELIMINATE COMPARISON SHOPPING — Did the handler give the caller enough confidence and differentiation to stop them from calling competitors? Were expertise, response time, or insurance experience used as trust-builders? Was any urgency created around acting quickly?

3. CONTROL THE FUTURE STATE — Did the handler walk the caller through what happens next — the inspection, the process, insurance coordination, timeline? Did the caller leave feeling mentally committed and confident in this company?

4. CLOSE TODAY — Was there a direct close attempt before the call ended? If the appointment was not booked, identify the specific moment the sale was lost and write the exact words the handler should have said instead.

Finish with: What was the single most important missed opportunity, and what should the handler have said?`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let settings
  try {
    ;({ settings } = await getSettings(event.headers['authorization']))
  } catch (err) {
    return json(err.message.startsWith('Unauthorized') ? 401 : 400, { error: err.message })
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const { transcript, salesTipsPrompt } = body
  if (!transcript) return json(400, { error: 'Missing transcript' })

  // Use prompt from request body, fall back to user's saved prompt, then default
  const tipsInstructions = salesTipsPrompt || settings.sales_tips_prompt || DEFAULT_SALES_TIPS_PROMPT

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

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
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

    return json(200, { analysis })
  } catch (err) {
    return json(500, { error: 'Analysis failed', message: err.message })
  }
}

