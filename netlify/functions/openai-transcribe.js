/**
 * Standard Tier — Step 1: Transcribe a call recording with OpenAI Whisper-1.
 *
 * Body (JSON): { audioUrl: string }
 * Header: Authorization: Bearer <supabase_jwt>
 * Returns: { transcript: string }
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'

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

  const { audioUrl } = body
  if (!audioUrl) return json(400, { error: 'Missing audioUrl' })

  try {
    // Download the audio file
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      return json(502, { error: 'Failed to download audio', status: audioRes.status })
    }
    const audioBuffer = await audioRes.arrayBuffer()
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' })

    // Build multipart form for Whisper
    const form = new FormData()
    form.append('file', audioBlob, 'recording.mp3')
    form.append('model', 'whisper-1')
    form.append('response_format', 'text')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.openai_api_key}` },
      body: form,
    })

    if (!res.ok) {
      const err = await res.json()
      return json(res.status, { error: 'Whisper API error', details: err })
    }

    const transcript = await res.text()
    return json(200, { transcript: transcript.trim() })
  } catch (err) {
    return json(500, { error: 'Transcription failed', message: err.message })
  }
}

