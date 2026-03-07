/**
 * admin-remove-user.js
 *
 * Removes a user from the caller's company by deleting their company_members row.
 * The auth user and their call history are preserved — they simply lose access
 * to the company's calls.
 *
 * Security:
 *  - Caller must be an admin in company_members
 *  - Caller cannot remove themselves
 *  - Target must be in the same company as the caller
 *
 * DELETE /.netlify/functions/admin-remove-user
 * Body: { userId: string }
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
    return jsonResponse(500, { error: 'Server misconfiguration: missing Supabase credentials.' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return jsonResponse(401, { error: 'Unauthorized: invalid or expired session.' })
  }

  // ── Verify caller is an admin ───────────────────────────────
  const { data: callerMembership, error: callerError } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user.id)
    .single()

  if (callerError || !callerMembership) {
    return jsonResponse(403, { error: 'You are not a member of any company.' })
  }

  if (callerMembership.role !== 'admin') {
    return jsonResponse(403, { error: 'Only company admins can remove users.' })
  }

  // ── Parse body ──────────────────────────────────────────────
  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return jsonResponse(400, { error: 'Invalid request body — must be JSON.' })
  }

  const { userId } = body
  if (!userId) {
    return jsonResponse(400, { error: 'userId is required.' })
  }

  if (userId === user.id) {
    return jsonResponse(400, { error: 'You cannot remove yourself from the company.' })
  }

  // ── Verify target is in the same company ────────────────────
  const { data: targetMembership, error: targetError } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('company_id', callerMembership.company_id)
    .single()

  if (targetError || !targetMembership) {
    return jsonResponse(404, { error: 'User not found in your company.' })
  }

  // ── Remove from company ─────────────────────────────────────
  // Deletes the company_members row only — auth user and call data are preserved.
  const { error: removeError } = await supabase
    .from('company_members')
    .delete()
    .eq('user_id', userId)
    .eq('company_id', callerMembership.company_id)

  if (removeError) {
    return jsonResponse(500, { error: 'Failed to remove user: ' + removeError.message })
  }

  return jsonResponse(200, { success: true })
}
