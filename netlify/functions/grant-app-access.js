/**
 * grant-app-access.js
 *
 * Grants a user access to a specific app by upserting a row into user_app_access.
 * Requires a valid super admin session.
 *
 * POST /.netlify/functions/grant-app-access
 * Body: { userId: string, appName: string }
 */

import { createClient } from '@supabase/supabase-js'
import { jsonResponse } from './_getSettings.js'

const VALID_APPS = ['call-analyzer', 'guardian-sms', 'albi-hubspot-import']

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Unauthorized: missing session token.' })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'Server misconfiguration.' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return jsonResponse(401, { error: 'Unauthorized: invalid or expired session.' })
  }

  // Only super admins can grant access
  const { data: saData } = await supabase
    .from('super_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .single()

  if (!saData) {
    return jsonResponse(403, { error: 'You do not have permission to grant app access.' })
  }

  let body
  try { body = JSON.parse(event.body) } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const { userId, appName } = body
  if (!userId) return jsonResponse(400, { error: 'userId is required.' })
  if (!appName) return jsonResponse(400, { error: 'appName is required.' })
  if (!VALID_APPS.includes(appName)) {
    return jsonResponse(400, { error: `Invalid appName. Must be one of: ${VALID_APPS.join(', ')}` })
  }

  const { error: upsertError } = await supabase
    .from('user_app_access')
    .upsert({ user_id: userId, app_name: appName }, { onConflict: 'user_id,app_name' })

  if (upsertError) {
    return jsonResponse(500, { error: 'Failed to grant access: ' + upsertError.message })
  }

  return jsonResponse(200, { success: true, userId, appName })
}
