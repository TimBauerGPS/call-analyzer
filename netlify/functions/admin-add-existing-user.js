/**
 * admin-add-existing-user.js
 *
 * Grants an EXISTING Supabase auth user (e.g. from another app on the same
 * project) access to this app by inserting a company_members row.
 * No new auth account is created.
 *
 * SUPER ADMIN: can specify companyId or newCompanyName, and role
 * COMPANY ADMIN: always adds to their own company with role 'member'
 *
 * POST /.netlify/functions/admin-add-existing-user
 * Body: { email: string, companyId?: string, newCompanyName?: string, role?: 'admin'|'member' }
 */

import { createClient } from '@supabase/supabase-js'
import { jsonResponse } from './_getSettings.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
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

  const { email } = body
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return jsonResponse(400, { error: 'A valid email address is required.' })
  }
  const normalizedEmail = email.trim().toLowerCase()

  // ── Privilege check ─────────────────────────────────────────
  const [saResult, memberResult] = await Promise.all([
    supabase.from('super_admins').select('user_id').eq('user_id', user.id).single(),
    supabase.from('company_members').select('company_id, role').eq('user_id', user.id).single(),
  ])

  const isSuperAdmin = !!saResult.data
  const callerMembership = memberResult.data

  let targetCompanyId
  let targetRole = 'member'

  if (isSuperAdmin) {
    targetRole = body.role === 'admin' ? 'admin' : 'member'

    if (body.newCompanyName?.trim()) {
      const name = body.newCompanyName.trim()
      const { data: newCo, error: coErr } = await supabase
        .from('companies')
        .insert({ name })
        .select('id')
        .single()

      if (coErr) {
        const { data: existing } = await supabase
          .from('companies').select('id').eq('name', name).single()
        if (existing) {
          targetCompanyId = existing.id
        } else {
          return jsonResponse(400, { error: 'Could not create company: ' + coErr.message })
        }
      } else {
        targetCompanyId = newCo.id
      }
    } else if (body.companyId) {
      targetCompanyId = body.companyId
    } else {
      return jsonResponse(400, { error: 'companyId or newCompanyName is required.' })
    }
  } else if (callerMembership?.role === 'admin') {
    targetCompanyId = callerMembership.company_id
  } else {
    return jsonResponse(403, { error: 'You do not have permission to add users.' })
  }

  // ── Find the existing auth user by email ────────────────────
  // List up to 1000 users and find by exact email match.
  // For larger deployments, replace with a paginated search.
  const { data: { users: allUsers }, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  })

  if (listError) {
    return jsonResponse(500, { error: 'Failed to search for user: ' + listError.message })
  }

  const targetUser = allUsers?.find(u => u.email?.toLowerCase() === normalizedEmail)
  if (!targetUser) {
    return jsonResponse(404, {
      error: `No account found for ${normalizedEmail}. Use "Create new user" to create a new account.`,
    })
  }

  if (targetUser.id === user.id) {
    return jsonResponse(400, { error: 'You cannot add yourself.' })
  }

  // ── Check if already a member of the target company ─────────
  const { data: existing } = await supabase
    .from('company_members')
    .select('user_id, role')
    .eq('user_id', targetUser.id)
    .eq('company_id', targetCompanyId)
    .single()

  if (existing) {
    return jsonResponse(409, {
      error: `${normalizedEmail} already has access to this company (role: ${existing.role}).`,
    })
  }

  // ── Tag user as belonging to this app ───────────────────────
  await supabase.auth.admin.updateUserById(targetUser.id, {
    user_metadata: { signup_app: 'call-analyzer' },
  })

  // ── Insert company_members row ───────────────────────────────
  const { error: insertError } = await supabase
    .from('company_members')
    .insert({ user_id: targetUser.id, company_id: targetCompanyId, role: targetRole })

  if (insertError) {
    return jsonResponse(500, { error: 'Failed to add user: ' + insertError.message })
  }

  return jsonResponse(200, {
    success: true,
    user: { id: targetUser.id, email: targetUser.email },
    companyId: targetCompanyId,
    role: targetRole,
  })
}
