/**
 * admin-remove-user.js
 *
 * Removes a user from a company by deleting their company_members row.
 * The auth user and their call history are preserved.
 *
 * SUPER ADMIN: must supply both userId and companyId (can remove from any company)
 * COMPANY ADMIN: must supply userId; companyId is inferred from their own membership
 *
 * DELETE /.netlify/functions/admin-remove-user
 * Body: { userId: string, companyId?: string }
 */

import { createClient } from '@supabase/supabase-js'
import { jsonResponse } from './_getSettings.js'

export async function handler(event) {
  if (event.httpMethod !== 'DELETE') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  // ── Auth ────────────────────────────────────────────────────
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

  // ── Parse body ──────────────────────────────────────────────
  let body
  try { body = JSON.parse(event.body) } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const { userId } = body
  if (!userId) return jsonResponse(400, { error: 'userId is required.' })
  if (userId === user.id) return jsonResponse(400, { error: 'You cannot remove yourself.' })

  // ── Privilege check ─────────────────────────────────────────
  const [saResult, memberResult] = await Promise.all([
    supabase.from('super_admins').select('user_id').eq('user_id', user.id).single(),
    supabase.from('company_members').select('company_id, role').eq('user_id', user.id).single(),
  ])

  const isSuperAdmin = !!saResult.data
  const callerMembership = memberResult.data

  let targetCompanyId

  if (isSuperAdmin) {
    if (!body.companyId) return jsonResponse(400, { error: 'companyId is required for super admin.' })
    targetCompanyId = body.companyId
  } else if (callerMembership?.role === 'admin') {
    targetCompanyId = callerMembership.company_id
  } else {
    return jsonResponse(403, { error: 'You do not have permission to remove users.' })
  }

  // ── Verify target is in the company ────────────────────────
  const { data: targetMembership } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('company_id', targetCompanyId)
    .single()

  if (!targetMembership) {
    return jsonResponse(404, { error: 'User not found in that company.' })
  }

  // ── Remove from company ─────────────────────────────────────
  const { error: removeError } = await supabase
    .from('company_members')
    .delete()
    .eq('user_id', userId)
    .eq('company_id', targetCompanyId)

  if (removeError) {
    return jsonResponse(500, { error: 'Failed to remove user: ' + removeError.message })
  }

  return jsonResponse(200, { success: true })
}
