/**
 * Standard Tier — Step 2: Analyze a transcript with GPT-4o-mini.
 *
 * Body (JSON): { transcript: string, salesTipsPrompt?: string }
 * Header: Authorization: Bearer <supabase_jwt>
 * Returns full analysis JSON matching the reference Apps Script field set.
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'

const DEFAULT_SALES_TIPS_PROMPT = `1. What could the handler have done to book this on the spot?
2. Was insurance mentioned as a funding source?
3. Was an appointment/inspection offered?
4. Did the caller appear interested?
5. General sales tips for this specific call.`

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
  "coachingTips": ["tip1", "tip2", "tip3"],
  "missedFlags": ["flag1", "flag2"]
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

