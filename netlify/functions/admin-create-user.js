/**
 * admin-create-user.js
 *
 * Creates a new Supabase auth user and immediately assigns them to the
 * caller's company with the 'member' role.
 *
 * Security model:
 *  - Caller must supply a valid JWT (verified server-side via service role key)
 *  - Caller must be an 'admin' in company_members — otherwise 403
 *  - New user is auto-confirmed (email_confirm: true) so they can log in immediately
 *  - If the company_members INSERT fails, the created auth user is deleted to avoid orphans
 *
 * POST /.netlify/functions/admin-create-user
 * Body: { email: string, password: string }
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

  // ── Verify caller is an admin in a company ──────────────────
  const { data: callerMembership, error: membershipError } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user.id)
    .single()

  if (membershipError || !callerMembership) {
    return jsonResponse(403, { error: 'You are not a member of any company.' })
  }

  if (callerMembership.role !== 'admin') {
    return jsonResponse(403, { error: 'Only company admins can create users.' })
  }

  // ── Parse body ──────────────────────────────────────────────
  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return jsonResponse(400, { error: 'Invalid request body — must be JSON.' })
  }

  const { email, password } = body
  if (!email || !password) {
    return jsonResponse(400, { error: 'email and password are required.' })
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    return jsonResponse(400, { error: 'Invalid email address.' })
  }
  if (typeof password !== 'string' || password.length < 8) {
    return jsonResponse(400, { error: 'Password must be at least 8 characters.' })
  }

  // ── Create the auth user ────────────────────────────────────
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,  // skip email verification — admin is creating the account
  })

  if (createError) {
    // Surface duplicate-email errors clearly
    return jsonResponse(400, { error: createError.message })
  }

  const newUserId = created.user.id

  // ── Assign to company ───────────────────────────────────────
  const { error: memberError } = await supabase
    .from('company_members')
    .insert({
      user_id:    newUserId,
      company_id: callerMembership.company_id,
      role:       'member',
    })

  if (memberError) {
    // Roll back: delete the auth user so we don't leave an orphan
    await supabase.auth.admin.deleteUser(newUserId)
    return jsonResponse(500, {
      error: 'Failed to assign user to company — account was not created. ' + memberError.message,
    })
  }

  return jsonResponse(200, {
    success: true,
    user: {
      id:    newUserId,
      email: created.user.email,
    },
  })
}
