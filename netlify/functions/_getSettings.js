/**
 * Shared utility for all serverless functions.
 *
 * Flow:
 *  1. Extract the user's Supabase JWT from the Authorization header
 *  2. Validate it with the Supabase Auth API (server-side, using service role key)
 *  3. Fetch that user's API keys from user_settings
 *  4. Return { user, settings } — never exposes keys to the browser
 *
 * Netlify ignores files starting with _ as function endpoints.
 */

import { createClient } from '@supabase/supabase-js'

export async function getSettings(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: missing session token.')
  }

  const jwt = authHeader.slice(7)

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Server misconfiguration: missing Supabase service credentials.')
  }

  // Service role client bypasses RLS — only used server-side
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Validate the user's JWT
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    throw new Error('Unauthorized: invalid or expired session.')
  }

  // Fetch the user's stored API keys
  const { data: settings, error: settingsError } = await supabase
    .from('user_settings')
    .select('callrail_api_key, callrail_account_id, openai_api_key, sales_tips_prompt')
    .eq('user_id', user.id)
    .single()

  if (settingsError || !settings) {
    throw new Error('API keys not configured. Please add them in Settings before fetching calls.')
  }

  if (!settings.callrail_api_key || !settings.callrail_account_id) {
    throw new Error('CallRail API Key and Account ID are required. Please configure them in Settings.')
  }

  if (!settings.openai_api_key) {
    throw new Error('OpenAI API Key is required. Please configure it in Settings.')
  }

  return { user, settings }
}

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
