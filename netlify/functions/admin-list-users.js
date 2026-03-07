/**
 * admin-list-users.js
 *
 * Returns all members of the caller's company, including their email
 * addresses (fetched via the admin API — not accessible to clients).
 *
 * Any authenticated member of a company can call this endpoint.
 * Admins see all members; regular members also see all members (read-only).
 *
 * GET /.netlify/functions/admin-list-users
 * Returns: { members: Array<{ id, email, role, created_at, isCurrentUser }>, callerRole }
 */

import { createClient } from '@supabase/supabase-js'
import { jsonResponse } from './_getSettings.js'

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
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

  // ── Get caller's company membership ────────────────────────
  const { data: callerMembership, error: callerError } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user.id)
    .single()

  if (callerError || !callerMembership) {
    return jsonResponse(403, { error: 'You are not a member of any company.' })
  }

  // ── Fetch all members of the same company ───────────────────
  const { data: members, error: membersError } = await supabase
    .from('company_members')
    .select('user_id, role, created_at')
    .eq('company_id', callerMembership.company_id)
    .order('created_at', { ascending: true })

  if (membersError) {
    return jsonResponse(500, { error: 'Failed to load team members: ' + membersError.message })
  }

  // ── Enrich with email from auth.users (requires service role) ─
  const enriched = await Promise.all(
    members.map(async (m) => {
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(m.user_id)
      return {
        id:            m.user_id,
        email:         authUser?.email || '(unknown)',
        role:          m.role,
        created_at:    m.created_at,
        isCurrentUser: m.user_id === user.id,
      }
    })
  )

  return jsonResponse(200, {
    members:    enriched,
    companyId:  callerMembership.company_id,
    callerRole: callerMembership.role,
  })
}
