/**
 * Proxy: Fetch calls from CallRail for a date range.
 * API keys are fetched server-side from the user's Supabase settings.
 *
 * Query params: start (ISO date), end (ISO date)
 * Header: Authorization: Bearer <supabase_jwt>
 */
import { getSettings, jsonResponse as json } from './_getSettings.js'

export const handler = async (event) => {
  const { start, end, partnerId } = event.queryStringParameters || {}
  let settings
  try {
    ;({ settings } = await getSettings(event.headers['authorization'], { partnerId }))
  } catch (err) {
    return json(err.message.startsWith('Unauthorized') ? 401 : 400, { error: err.message })
  }
  if (!start || !end) return json(400, { error: 'Missing required params: start, end' })

  const fields = [
    'id', 'start_time', 'duration', 'customer_phone_number',
    'source', 'source_name', 'recording', 'recording_player',
    'answered', 'direction',
    // Attribution / PPC fields
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'gclid', 'landing_page_url', 'referring_url',
  ].join(',')

  const url = new URL(`https://api.callrail.com/v3/a/${settings.callrail_account_id}/calls.json`)
  url.searchParams.set('date_range_start', start)
  url.searchParams.set('date_range_end', end)
  url.searchParams.set('fields', fields)
  url.searchParams.set('sort', 'start_time')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '250')

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Token token=${settings.callrail_api_key}` },
    })
    const data = await res.json()
    if (!res.ok) return json(res.status, { error: data.error || 'CallRail API error', details: data })
    return json(200, { calls: data.calls || [] })
  } catch (err) {
    return json(500, { error: 'Failed to fetch from CallRail', message: err.message })
  }
}
