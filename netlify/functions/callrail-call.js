/**
 * Proxy: Fetch a single call's details from CallRail and resolve its recording
 * to a direct audio URL, following redirects and dropping auth once off callrail.com.
 *
 * Replicates the downloadAudio() redirect-loop logic from the reference Apps Script.
 *
 * Query param: callId
 * Header: Authorization: Bearer <supabase_jwt>
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'

export const handler = async (event) => {
  const { callId, partnerId } = event.queryStringParameters || {}
  let settings
  try {
    ;({ settings } = await getSettings(event.headers['authorization'], { partnerId }))
  } catch (err) {
    return json(err.message.startsWith('Unauthorized') ? 401 : 400, { error: err.message })
  }
  if (!callId) return json(400, { error: 'Missing required param: callId' })

  try {
    const metaRes = await fetch(
      `https://api.callrail.com/v3/a/${settings.callrail_account_id}/calls/${callId}.json`,
      { headers: { Authorization: `Token token=${settings.callrail_api_key}` } }
    )
    if (!metaRes.ok) {
      const err = await metaRes.json()
      return json(metaRes.status, { error: 'CallRail error', details: err })
    }
    const callData = await metaRes.json()

    if (!callData.recording) return json(404, { error: 'No recording available for this call.' })

    const audioUrl = await resolveAudioUrl(callData.recording, settings.callrail_api_key)
    return json(200, { call: callData, audioUrl })
  } catch (err) {
    return json(500, { error: 'Failed to fetch call', message: err.message })
  }
}

/**
 * Follow CallRail's redirect chain to the final S3/GCS audio URL.
 * Auth header must be dropped once we leave callrail.com.
 */
async function resolveAudioUrl(initialUrl, apiKey) {
  let currentUrl = initialUrl
  let useAuth = true

  for (let i = 0; i < 6; i++) {
    const isStorageCdn =
      currentUrl.includes('amazonaws.com') ||
      currentUrl.includes('googleusercontent.com') ||
      currentUrl.includes('storage.googleapis.com')

    if (isStorageCdn) useAuth = false

    const headers = useAuth ? { Authorization: `Token token=${apiKey}` } : {}

    const res = await fetch(currentUrl, { redirect: 'manual', headers })
    const status = res.status

    if (status === 301 || status === 302 || status === 307 || status === 308) {
      const location = res.headers.get('location')
      if (!location) break
      if (!location.includes('callrail')) useAuth = false
      currentUrl = location
      continue
    }

    if (status === 200) {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('json')) {
        // Some CallRail endpoints return a JSON wrapper with a .url field
        const body = await res.json()
        if (body.url) {
          currentUrl = body.url
          useAuth = false
          continue
        }
      }
      // Reached the actual audio file
      return currentUrl
    }

    break
  }

  return currentUrl
}

