/**
 * callrail-test-partner.js
 *
 * Tests CallRail connectivity for a specific partner company.
 * Returns detailed diagnostics: which keys are in use, what CallRail returns,
 * and a human-readable error if anything is misconfigured.
 *
 * POST /.netlify/functions/callrail-test-partner
 * Body: { partnerId: string }
 */

import { getSettings, jsonResponse } from './_getSettings.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization']

  let body
  try { body = JSON.parse(event.body) } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const { partnerId } = body
  if (!partnerId) return jsonResponse(400, { error: 'partnerId is required.' })

  // Resolve settings the same way the real fetch does
  let settings, user
  try {
    ;({ settings, user } = await getSettings(authHeader, { partnerId, requireCallRail: true }))
  } catch (err) {
    // Settings resolution failed — return structured diagnostics
    return jsonResponse(200, {
      ok: false,
      stage: 'settings',
      error: err.message,
      detail: 'Failed to resolve API keys before making any CallRail request.',
    })
  }

  const { callrail_api_key, callrail_account_id, callrail_company_id } = settings

  // Build the test URL — fetch a single call to verify credentials + account access
  const url = new URL(`https://api.callrail.com/v3/a/${callrail_account_id}/calls.json`)
  url.searchParams.set('per_page', '1')
  url.searchParams.set('fields', 'id,start_time,duration')
  if (callrail_company_id) {
    url.searchParams.set('company_id', callrail_company_id)
  }

  let crStatus, crStatusText, crBody
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Token token=${callrail_api_key}`,
        'Content-Type': 'application/json',
      },
    })
    crStatus = res.status
    crStatusText = res.statusText
    crBody = await res.json().catch(() => null)
  } catch (err) {
    return jsonResponse(200, {
      ok: false,
      stage: 'network',
      error: `Network error contacting CallRail: ${err.message}`,
      apiKeyHint: `...${callrail_api_key.slice(-6)}`,
      accountId: callrail_account_id,
      companyId: callrail_company_id || null,
    })
  }

  if (crStatus === 200) {
    const totalCalls = crBody?.total_records ?? crBody?.calls?.length ?? 'unknown'
    return jsonResponse(200, {
      ok: true,
      stage: 'success',
      message: `Connection successful. ${totalCalls} total call(s) found.`,
      apiKeyHint: `...${callrail_api_key.slice(-6)}`,
      accountId: callrail_account_id,
      companyId: callrail_company_id || null,
      totalCalls,
    })
  }

  // Map common CallRail error codes to helpful messages
  const errorMessages = {
    401: 'Invalid or expired API key. Check the shared CallRail API key in Settings.',
    403: 'Access denied. The API key does not have permission to access this account or company.',
    404: 'Account or company not found. Verify the Account ID / Company ID mapping is correct.',
    422: 'Invalid request parameters sent to CallRail.',
    429: 'CallRail rate limit hit. Try again in a moment.',
  }

  const friendlyError = errorMessages[crStatus]
    || `CallRail returned an unexpected status (${crStatus} ${crStatusText}).`

  return jsonResponse(200, {
    ok: false,
    stage: 'callrail',
    httpStatus: crStatus,
    httpStatusText: crStatusText,
    error: friendlyError,
    callrailMessage: crBody?.error || crBody?.message || null,
    apiKeyHint: `...${callrail_api_key.slice(-6)}`,
    accountId: callrail_account_id,
    companyId: callrail_company_id || null,
  })
}
