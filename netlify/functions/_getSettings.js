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

// partnerId: optional uuid from user_partners table.
// If supplied, the partner's CallRail keys override company/user keys,
// but the user's own OpenAI key is always used (never the partner's).
export async function getSettings(authHeader, { partnerId, requireCallRail = true } = {}) {
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

  // Determine the user's company (if any)
  const { data: memberData } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .single()

  const companyId = memberData?.company_id || null

  // API keys are stored at the company level in company_settings.
  // Fall back to user_settings for super admins or users without a company.
  let apiKeys = {}
  if (companyId) {
    const { data: cs } = await supabase
      .from('company_settings')
      .select('callrail_api_key, callrail_account_id, openai_api_key')
      .eq('company_id', companyId)
      .single()
    if (cs) apiKeys = cs
  }

  // Partner override: if a specific partner ID is passed, use that partner's CallRail keys.
  // The user's own OpenAI key is still used (billing stays with the master user).
  if (partnerId) {
    const { data: partner, error: partnerErr } = await supabase
      .from('user_partners')
      .select('callrail_api_key, callrail_account_id, company_name')
      .eq('id', partnerId)
      .eq('user_id', user.id)   // security: must belong to this user
      .single()
    if (partnerErr || !partner) {
      throw new Error(`Partner not found or access denied (id: ${partnerId}).`)
    }
    if (!partner.callrail_api_key || !partner.callrail_account_id) {
      throw new Error(`Partner "${partner.company_name}" is missing CallRail credentials. Add them in Settings → Partner Companies.`)
    }
    apiKeys.callrail_api_key    = partner.callrail_api_key
    apiKeys.callrail_account_id = partner.callrail_account_id
  }

  // Fallback: user_settings (backwards compat / super admins / regular users not in a company)
  // Skip CallRail fallback if partner keys were already set above.
  if (!apiKeys.openai_api_key) {
    const { data: us } = await supabase
      .from('user_settings')
      .select('callrail_api_key, callrail_account_id, openai_api_key')
      .eq('user_id', user.id)
      .single()
    if (us) {
      if (!apiKeys.callrail_api_key) {
        apiKeys.callrail_api_key    = us.callrail_api_key    || null
        apiKeys.callrail_account_id = us.callrail_account_id || null
      }
      apiKeys.openai_api_key = us.openai_api_key || null
    }
  }

  // Sales tips prompt is always per-user (everyone can customize their coaching questions)
  const { data: promptData } = await supabase
    .from('user_settings')
    .select('sales_tips_prompt')
    .eq('user_id', user.id)
    .single()

  const settings = {
    callrail_api_key:    apiKeys.callrail_api_key    || null,
    callrail_account_id: apiKeys.callrail_account_id || null,
    openai_api_key:      apiKeys.openai_api_key      || null,
    sales_tips_prompt:   promptData?.sales_tips_prompt || null,
  }

  if (requireCallRail && (!settings.callrail_api_key || !settings.callrail_account_id)) {
    throw new Error('CallRail API Key and Account ID are not configured. Add them in Settings' + (partnerId ? ' → Partner Companies.' : '.'))
  }

  if (!settings.openai_api_key) {
    throw new Error('OpenAI API Key is not configured. An admin must add it in Settings.')
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
