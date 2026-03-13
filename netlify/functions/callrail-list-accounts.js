/**
 * Returns all CallRail accounts accessible by the user's shared CallRail API key.
 * Uses the key stored in user_settings.callrail_api_key.
 * Calls GET /v3/a.json on the CallRail API.
 */
import { createClient } from '@supabase/supabase-js'
import { jsonResponse as json } from './_getSettings.js'

export const handler = async (event) => {
  const authHeader = event.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'Unauthorized: missing session token.' })
  }

  const jwt = authHeader.slice(7)
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Server misconfiguration.' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) return json(401, { error: 'Unauthorized: invalid or expired session.' })

  const { data: us } = await supabase
    .from('user_settings')
    .select('callrail_api_key')
    .eq('user_id', user.id)
    .single()

  const apiKey = us?.callrail_api_key
  if (!apiKey) {
    return json(400, { error: 'No shared CallRail API key found. Enter it in Settings first.' })
  }

  try {
    const res = await fetch('https://api.callrail.com/v3/a.json', {
      headers: { Authorization: `Token token=${apiKey}` },
    })
    const data = await res.json()
    if (!res.ok) return json(res.status, { error: data.error || 'CallRail API error', details: data })

    const accounts = (data.accounts || []).map(a => ({ id: String(a.id), name: a.name }))
    return json(200, { accounts })
  } catch (err) {
    return json(500, { error: 'Failed to connect to CallRail', message: err.message })
  }
}
