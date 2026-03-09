/**
 * admin-list-users.js
 *
 * Returns team members and company info for the calling user.
 *
 * SUPER ADMIN response:
 *   { isSuperAdmin: true, companies: [{ id, name, members: [...] }] }
 *
 * COMPANY ADMIN / MEMBER response:
 *   { isSuperAdmin: false, companyId, callerRole, members: [...] }
 *
 * Each member object: { id, email, role, created_at, isCurrentUser }
 *
 * GET /.netlify/functions/admin-list-users
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

  // ── Privilege check ─────────────────────────────────────────
  const [saResult, memberResult] = await Promise.all([
    supabase.from('super_admins').select('user_id').eq('user_id', user.id).single(),
    supabase.from('company_members').select('company_id, role').eq('user_id', user.id).single(),
  ])

  const isSuperAdmin = !!saResult.data

  // Helper: enrich a company_members row with the auth user's email
  async function enrichMember(m) {
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(m.user_id)
    return {
      id:            m.user_id,
      email:         authUser?.email || '(unknown)',
      role:          m.role,
      created_at:    m.created_at,
      isCurrentUser: m.user_id === user.id,
    }
  }

  // ── Super admin: return all companies + all members ─────────
  if (isSuperAdmin) {
    const [companiesResult, allMembersResult] = await Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('company_members').select('user_id, company_id, role, created_at').order('created_at'),
    ])

    if (allMembersResult.error) {
      return jsonResponse(500, { error: allMembersResult.error.message })
    }

    // Enrich all members with email in parallel
    const enriched = await Promise.all(
      (allMembersResult.data || []).map(m => enrichMember(m).then(e => ({ ...e, company_id: m.company_id })))
    )

    // Group by company
    const companies = (companiesResult.data || []).map(c => ({
      id:      c.id,
      name:    c.name,
      members: enriched.filter(m => m.company_id === c.id),
    }))

    return jsonResponse(200, { isSuperAdmin: true, companies })
  }

  // ── Company admin / member: return their company's members ──
  const callerMembership = memberResult.data
  if (!callerMembership) {
    return jsonResponse(403, { error: 'You are not a member of any company.' })
  }

  const { data: members, error: membersError } = await supabase
    .from('company_members')
    .select('user_id, role, created_at')
    .eq('company_id', callerMembership.company_id)
    .order('created_at')

  if (membersError) {
    return jsonResponse(500, { error: membersError.message })
  }

  const enriched = await Promise.all((members || []).map(enrichMember))

  return jsonResponse(200, {
    isSuperAdmin: false,
    companyId:    callerMembership.company_id,
    callerRole:   callerMembership.role,
    members:      enriched,
  })
}
