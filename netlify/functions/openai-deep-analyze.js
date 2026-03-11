/**
 * Deep Tier: Send audio directly to GPT-4o Audio Preview for single-pass
 * transcription + analysis. Returns all standard fields PLUS tonal feedback
 * and talk-time ratio. Replicates analyzeAudioDirectly() from the reference
 * Apps Script.
 *
 * Body (JSON): { audioUrl: string, salesTipsPrompt?: string }
 * Header: Authorization: Bearer <supabase_jwt>
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'

const DEFAULT_SALES_TIPS_PROMPT = `Evaluate this call against the four critical sales goals below. For each, cite specific moments and note where the handler's tone, confidence, or language helped or hurt. Be direct and actionable.

1. BOOK THE APPOINTMENT — Did the handler ask clearly and confidently for the inspection? Was a specific date and time secured, or did the call end without a committed next step? Was urgency communicated?

2. ELIMINATE COMPARISON SHOPPING — Did the handler give the caller enough confidence, authority, and differentiation that they felt no need to call anyone else? Were response time, expertise, or insurance experience used as trust-builders? Did the handler convey any sense of urgency (secondary damage, insurance timelines, availability)?

3. CONTROL THE FUTURE STATE — Did the handler paint a clear picture of what happens next — the inspection, the process, insurance coordination, timeline expectations? Did the caller leave the call mentally committed and emotionally confident in this company specifically?

4. CLOSE TODAY — Was there a direct, confident close attempt before the call ended? If the appointment was not booked, identify the exact moment the sale was lost and write the specific words the handler should have said instead.

Finish with: What was the single most important missed opportunity on this call, and what should the handler have said?`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let settings
  try {
    ;({ settings } = await getSettings(event.headers['authorization'], { requireCallRail: false }))
  } catch (err) {
    return json(err.message.startsWith('Unauthorized') ? 401 : 400, { error: err.message })
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const { audioUrl, salesTipsPrompt } = body
  if (!audioUrl) return json(400, { error: 'Missing audioUrl' })

  const tipsInstructions = salesTipsPrompt || settings.sales_tips_prompt || DEFAULT_SALES_TIPS_PROMPT

  try {
    // Download audio and encode to base64
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      return json(502, { error: 'Failed to download audio', status: audioRes.status })
    }
    const audioBuffer = await audioRes.arrayBuffer()
    const base64Audio = Buffer.from(audioBuffer).toString('base64')

    const systemPrompt = `You are a Sales Call Analyst for a Restoration company. Listen to the audio and analyze the call.

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
  "coachingTips": ["tip1 — specific, actionable coaching point tied to booking, comparison shopping, future state, or closing", "tip2", "tip3"],
  "missedFlags": ["flag1 — specific moment where handler lost control, invited comparison shopping, failed to close, or left caller without confidence", "flag2"],
  "tonalFeedback": "string — assess handler confidence, urgency, empathy, and closing energy. Note where tone built or eroded trust. Did the handler sound like an authority the caller should commit to, or like one of many options?",
  "talkTimeRatio": "string — e.g. Agent 40% / Caller 60%",
  "transcript": "string — full verbatim transcript of the call"
}

No markdown fences. No extra keys. JSON only.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openai_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-audio-preview',
        modalities: ['text'],
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: base64Audio, format: 'mp3' },
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      return json(res.status, { error: 'OpenAI API error', details: err })
    }

    const data = await res.json()
    const rawContent = data.choices?.[0]?.message?.content || '{}'

    // Strip markdown fences if model adds them despite instructions
    const cleaned = rawContent.replace(/```json\n?|```\n?/g, '').trim()

    let analysis
    try {
      analysis = JSON.parse(cleaned)
    } catch {
      return json(500, { error: 'Failed to parse AI response', raw: rawContent })
    }

    return json(200, { analysis })
  } catch (err) {
    return json(500, { error: 'Deep analysis failed', message: err.message })
  }
}

