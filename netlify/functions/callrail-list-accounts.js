/**
 * Returns CallRail companies (partner clients) accessible by the user's shared API key.
 *
 * Flow:
 *  1. GET /v3/a.json — lists top-level accounts the key can access
 *  2a. If multiple accounts returned → those ARE the partner accounts (agency key mode)
 *  2b. If only 1 account returned → that is the parent account; fetch its companies via
 *      GET /v3/a/{account_id}/companies.json (sub-company mode, most common for single-agency)
 *
 * Response:
 *  { items: [{id, name}], mode: 'accounts'|'companies', parentAccountId: string|null }
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

  const headers = { Authorization: `Token token=${apiKey}` }

  try {
    // Step 1: list top-level accounts
    const accountsRes = await fetch('https://api.callrail.com/v3/a.json', { headers })
    const accountsData = await accountsRes.json()
    if (!accountsRes.ok) return json(accountsRes.status, { error: accountsData.error || 'CallRail API error', details: accountsData })

    const accounts = (accountsData.accounts || []).map(a => ({ id: String(a.id), name: a.name }))

    // Step 2a: multiple accounts → agency key mode, use accounts directly
    if (accounts.length > 1) {
      return json(200, { items: accounts, mode: 'accounts', parentAccountId: null })
    }

    // Step 2b: single account → fetch its companies
    if (accounts.length === 1) {
      const parentAccountId = accounts[0].id
      const companiesRes = await fetch(
        `https://api.callrail.com/v3/a/${parentAccountId}/companies.json?per_page=250`,
        { headers }
      )
      const companiesData = await companiesRes.json()
      if (!companiesRes.ok) {
        // Fall back to returning the single account if companies endpoint fails
        return json(200, { items: accounts, mode: 'accounts', parentAccountId: null })
      }
      const companies = (companiesData.companies || []).map(c => ({ id: String(c.id), name: c.name }))
      if (companies.length > 0) {
        return json(200, { items: companies, mode: 'companies', parentAccountId })
      }
      // Companies endpoint returned empty — fall back to the account itself
      return json(200, { items: accounts, mode: 'accounts', parentAccountId: null })
    }

    return json(200, { items: [], mode: 'accounts', parentAccountId: null })
  } catch (err) {
    return json(500, { error: 'Failed to connect to CallRail', message: err.message })
  }
}
