/**
 * admin-create-user.js
 *
 * Creates a new Supabase auth user and assigns them to a company.
 *
 * SUPER ADMIN (in super_admins table):
 *   - Can specify any existing companyId, OR create a new company via newCompanyName
 *   - Can set role to 'admin' or 'member'
 *   - Required body: { email, password, companyId | newCompanyName, role? }
 *
 * COMPANY ADMIN (admin role in company_members):
 *   - Can only add users to their own company
 *   - New users always get role 'member'
 *   - Required body: { email, password }
 *
 * POST /.netlify/functions/admin-create-user
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

  const { email, password } = body
  if (!email || !password) return jsonResponse(400, { error: 'email and password are required.' })
  if (typeof email !== 'string' || !email.includes('@')) return jsonResponse(400, { error: 'Invalid email address.' })
  if (typeof password !== 'string' || password.length < 8) return jsonResponse(400, { error: 'Password must be at least 8 characters.' })

  // ── Determine caller privilege level ───────────────────────
  const [saResult, memberResult] = await Promise.all([
    supabase.from('super_admins').select('user_id').eq('user_id', user.id).single(),
    supabase.from('company_members').select('company_id, role').eq('user_id', user.id).single(),
  ])

  const isSuperAdmin = !!saResult.data
  const callerMembership = memberResult.data

  let targetCompanyId
  let targetRole = 'member'

  if (isSuperAdmin) {
    // Super admin: can specify any company or create a new one, set role, or create a master admin
    targetRole = ['admin', 'member', 'master_admin'].includes(body.role) ? body.role : 'member'

    if (targetRole === 'master_admin') {
      // Master admins have no company — handled after user creation
    } else if (body.newCompanyName?.trim()) {
      // Create a new company on the fly
      const name = body.newCompanyName.trim()
      const { data: newCo, error: coErr } = await supabase
        .from('companies')
        .insert({ name })
        .select('id')
        .single()

      if (coErr) {
        // Company already exists — find it
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
    // Regular company admin: always uses own company, role always 'member'
    targetCompanyId = callerMembership.company_id
  } else {
    return jsonResponse(403, { error: 'You do not have permission to create users.' })
  }

  // ── Create the auth user ────────────────────────────────────
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email:         email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { signup_app: 'call-analyzer' },
  })

  if (createError) {
    return jsonResponse(400, { error: createError.message })
  }

  const newUserId = created.user.id

  // ── Assign to company OR mark as master admin ───────────────
  if (targetRole === 'master_admin') {
    const { error: maError } = await supabase
      .from('user_settings')
      .upsert({ user_id: newUserId, is_master_admin: true }, { onConflict: 'user_id' })

    if (maError) {
      await supabase.auth.admin.deleteUser(newUserId)
      return jsonResponse(500, { error: 'Failed to set master admin flag: ' + maError.message })
    }
  } else {
    const { error: memberError } = await supabase
      .from('company_members')
      .insert({ user_id: newUserId, company_id: targetCompanyId, role: targetRole })

    if (memberError) {
      await supabase.auth.admin.deleteUser(newUserId)
      return jsonResponse(500, {
        error: 'Failed to assign user to company — account was not created. ' + memberError.message,
      })
    }
  }

  return jsonResponse(200, {
    success:    true,
    isSuperAdmin,
    user:       { id: newUserId, email: created.user.email },
    companyId:  targetCompanyId || null,
    role:       targetRole,
  })
}
