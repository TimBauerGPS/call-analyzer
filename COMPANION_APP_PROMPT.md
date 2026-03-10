# Companion App — Claude Code Handoff Prompt

Copy everything below this line and paste it to Claude Code in your other app.

---

## Context: Shared Supabase Infrastructure

This app shares a Supabase project with another app (a PPC Call Analyzer). That project already has a complete multi-tenant company sandboxing system built and running. **Do not recreate these tables or functions — they already exist and are shared across both apps.**

### What already exists in Supabase

**Tables (shared, do not recreate):**

```sql
-- All auth users are shared across both apps automatically (Supabase auth is project-wide)

companies (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
)

company_members (
  user_id    uuid REFERENCES auth.users NOT NULL,
  company_id uuid REFERENCES companies  NOT NULL,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
)
-- RLS: users can SELECT their own row only. INSERT/UPDATE/DELETE only via service role.

super_admins (
  user_id    uuid REFERENCES auth.users PRIMARY KEY,
  created_at timestamptz DEFAULT now()
)
-- RLS: users can SELECT their own row only. Writable only via Supabase dashboard.
```

**PostgreSQL helper functions (shared, do not recreate):**

```sql
-- Returns the company_id for the currently logged-in user.
-- SECURITY DEFINER so it bypasses RLS on company_members when called from other RLS policies.
get_my_company_id() RETURNS uuid

-- Returns true if the current user is in the super_admins table.
-- SECURITY DEFINER — same reason.
is_super_admin() RETURNS boolean
```

**Privilege levels:**
- **Super Admin** — row in `super_admins`. Can manage all companies, invite users to any company, create new companies. Only Tim has this.
- **Company Admin** — row in `company_members` with `role = 'admin'`. Can manage their own company's members.
- **Member** — row in `company_members` with `role = 'member'`. Can only access their company's data.
- **No access** — user exists in `auth.users` (perhaps from the other app) but has no `company_members` row. Can log in but sees nothing. This is expected and safe.

---

## Task: Implement Company Sandboxing in This App

### 1. Add company_id to your app's data tables

For every table in this app that stores user data, add company isolation using the same pattern:

```sql
-- Add company_id column to your table
ALTER TABLE your_table ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies;

-- Enable RLS
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- Drop old user-only policy if one exists
DROP POLICY IF EXISTS "user_isolation" ON your_table;

-- Add company-scoped policy using the shared helper function
CREATE POLICY "company_or_user_isolation" ON your_table
  FOR ALL
  USING (
    (company_id IS NOT NULL AND company_id = get_my_company_id())
    OR
    (company_id IS NULL AND user_id = auth.uid())
  );
```

### 2. Copy and adapt the four admin Netlify functions

The Call Analyzer has these four Netlify serverless functions. Copy them into this app's `netlify/functions/` folder. They connect to the same Supabase project via environment variables.

**Required environment variables (same as the Call Analyzer — reuse them):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Functions to copy and keep as-is (they use shared tables, no changes needed):**
- `admin-list-users.js` — lists company members; super admin sees all companies grouped
- `admin-remove-user.js` — removes a user from a company (preserves their auth account)
- `admin-add-existing-user.js` — adds an existing Supabase user (from either app) to a company by email, no new account created

**Function to copy and adapt:**
- `admin-create-user.js` — creates a NEW auth account. This version uses email + password. For this app, **replace it with an invite-by-email version** (see Section 3 below).

### 3. Invite flow — smart detection of new vs. existing users

Instead of creating users with a temporary password, use a single invite function that automatically detects whether the email already has an account.

**How it works:**
- For **existing users** (already registered on this Supabase project via either app): They are **silently added to the company with no email sent**. Their password and login are completely unchanged — just tell them the URL and they can log straight in with their existing credentials.
- For **new users** (no account anywhere on this project): Supabase creates their account and emails them a magic link to set their password and log in for the first time.

The response includes an `isExisting` boolean so your UI can show the right message — e.g. "Access granted, share the URL" vs. "Invite sent, check email".

Create `netlify/functions/admin-invite-user.js`:

```javascript
/**
 * admin-invite-user.js
 *
 * Invites a user by email with automatic detection:
 *
 * - EXISTING user (already has an account on this Supabase project from either app):
 *   Silently adds them to the company. NO email sent. They keep their existing
 *   password and login exactly as before — nothing changes for them. Just tell
 *   them the URL and they can log straight in.
 *
 * - NEW user (no account yet):
 *   Creates their account and sends a Supabase invite email with a magic link
 *   to set their password and log in for the first time.
 *
 * POST /.netlify/functions/admin-invite-user
 * Body: { email, companyId?, newCompanyName?, role? }
 * Header: Authorization: Bearer <supabase_jwt>
 */

import { createClient } from '@supabase/supabase-js'

function jsonResponse(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const authHeader = event.headers['authorization'] || event.headers['Authorization']
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse(401, { error: 'Unauthorized' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(500, { error: 'Server misconfiguration.' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const jwt = authHeader.slice(7)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) return jsonResponse(401, { error: 'Unauthorized: invalid or expired session.' })

  let body
  try { body = JSON.parse(event.body) } catch { return jsonResponse(400, { error: 'Invalid request body.' }) }

  const { email } = body
  if (!email?.includes('@')) return jsonResponse(400, { error: 'A valid email address is required.' })
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
      const { data: newCo, error: coErr } = await supabase
        .from('companies').insert({ name: body.newCompanyName.trim() }).select('id').single()
      if (coErr) {
        const { data: existing } = await supabase.from('companies').select('id').eq('name', body.newCompanyName.trim()).single()
        if (existing) { targetCompanyId = existing.id }
        else { return jsonResponse(400, { error: 'Could not create company: ' + coErr.message }) }
      } else { targetCompanyId = newCo.id }
    } else if (body.companyId) {
      targetCompanyId = body.companyId
    } else {
      return jsonResponse(400, { error: 'companyId or newCompanyName is required.' })
    }
  } else if (callerMembership?.role === 'admin') {
    targetCompanyId = callerMembership.company_id
  } else {
    return jsonResponse(403, { error: 'You do not have permission to invite users.' })
  }

  // ── Check if user already exists ────────────────────────────
  // List users and find by exact email match.
  const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const existingUser = allUsers?.find(u => u.email?.toLowerCase() === normalizedEmail)

  if (existingUser) {
    // ── EXISTING USER: just add to company, no email sent ──────
    // They keep their password and login exactly as before.
    const { data: alreadyMember } = await supabase
      .from('company_members')
      .select('user_id')
      .eq('user_id', existingUser.id)
      .eq('company_id', targetCompanyId)
      .single()

    if (alreadyMember) {
      return jsonResponse(409, { error: `${normalizedEmail} already has access to this company.` })
    }

    const { error: insertErr } = await supabase
      .from('company_members')
      .insert({ user_id: existingUser.id, company_id: targetCompanyId, role: targetRole })

    if (insertErr) {
      return jsonResponse(500, { error: 'Failed to add user: ' + insertErr.message })
    }

    return jsonResponse(200, {
      success: true,
      isExisting: true,
      userId: existingUser.id,
      email: normalizedEmail,
      companyId: targetCompanyId,
      role: targetRole,
      // Tell the admin what to communicate to the user
      message: `${normalizedEmail} already has an account and has been granted access. No email was sent — just share the app URL and they can log in with their existing password.`,
    })
  }

  // ── NEW USER: send Supabase invite email with magic link ─────
  // Creates their account. They receive an email to set their password.
  // redirectTo must be listed in Supabase Auth → URL Configuration → Redirect URLs.
  const redirectTo = APP_URL || 'https://your-app.netlify.app'
  const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
    normalizedEmail,
    { redirectTo }
  )

  if (inviteErr) {
    return jsonResponse(500, { error: 'Failed to send invite: ' + inviteErr.message })
  }

  // Add to company_members before they accept the invite
  const { error: insertErr } = await supabase
    .from('company_members')
    .insert({ user_id: inviteData.user.id, company_id: targetCompanyId, role: targetRole })

  if (insertErr) {
    return jsonResponse(500, { error: 'Invite email sent but failed to assign company: ' + insertErr.message })
  }

  return jsonResponse(200, {
    success: true,
    isExisting: false,
    userId: inviteData.user.id,
    email: normalizedEmail,
    companyId: targetCompanyId,
    role: targetRole,
    message: `Invite sent to ${normalizedEmail}. They will receive an email with a link to set their password and log in.`,
  })
}
```

**Add `APP_URL` to your Netlify environment variables:**
```
APP_URL=https://your-other-app.netlify.app
```

**Configure Supabase redirect URLs:**
In Supabase → Authentication → URL Configuration → Redirect URLs, add:
```
https://your-other-app.netlify.app
https://your-other-app.netlify.app/**
```

---

### 4. Load membership in your frontend

In your main authenticated component (equivalent of Dashboard.jsx), load both company membership and super admin status on mount:

```javascript
async function loadMembership() {
  const [memberResult, saResult] = await Promise.all([
    supabase
      .from('company_members')
      .select('role, company_id, companies(name)')
      .eq('user_id', session.user.id)
      .single(),
    supabase
      .from('super_admins')
      .select('user_id')
      .eq('user_id', session.user.id)
      .single(),
  ])

  if (memberResult.data) {
    setMembership({
      companyId:   memberResult.data.company_id,
      companyName: memberResult.data.companies?.name || null,
      role:        memberResult.data.role,
    })
  }

  if (saResult.data) {
    setIsSuperAdmin(true)
  }
}
```

Always include `company_id` when inserting records into your data tables:

```javascript
// When inserting data
await supabase.from('your_table').insert({
  user_id:    session.user.id,
  company_id: membership?.companyId || null,   // ← always include this
  // ... rest of your data
})
```

---

### 5. Team Management UI

Build a Team Management panel (admin-only) in your settings/admin area using the same three existing functions:

| Action | Netlify function | Notes |
|---|---|---|
| List members | `admin-list-users` | Super admin gets all companies grouped; company admin gets own company |
| Invite new or existing user | `admin-invite-user` | Sends Supabase email invite; works for users from either app |
| Add existing user silently | `admin-add-existing-user` | No email sent; use when user already knows to expect access |
| Remove user from company | `admin-remove-user` | Deletes company_members row only; preserves auth account and data |

The invite form should have:
- **Email field** (required)
- **Company selector** (super admin only — dropdown of all companies + "New company…" option)
- **Role selector** (super admin only — Member / Admin)
- **"Send Invite" button** — calls `admin-invite-user`

Show an "Existing user" toggle that calls `admin-add-existing-user` instead (for cases where the user already exists and you just want to silently grant access without sending an email).

---

### 6. Important Supabase notes

**Users from the other app can already log into this app** — Supabase auth is shared across all apps in a project. If they don't have a `company_members` row, they can log in but will see nothing (RLS blocks all data). This is safe and expected.

**The service role key bypasses RLS** — Never expose it in frontend code. Only use it in Netlify serverless functions.

**The anon key is safe to expose** — Use it in your frontend Supabase client. RLS ensures users only see their own company's data.

**`get_my_company_id()` and `is_super_admin()`** are `SECURITY DEFINER` functions — call them freely inside RLS policies on your own tables. They won't cause infinite recursion.
