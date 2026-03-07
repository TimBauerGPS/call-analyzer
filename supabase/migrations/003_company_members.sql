-- =============================================================
-- Migration 003: Company Members (multi-tenant sandboxing)
-- Run each section in order in the Supabase SQL Editor.
-- =============================================================


-- ── 1. Companies table ────────────────────────────────────────
-- (May already exist from a previous session — safe to re-run.)
CREATE TABLE IF NOT EXISTS companies (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

-- Companies are readable by any authenticated user (just names — no sensitive data).
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Drop and recreate to avoid "already exists" errors on re-runs:
DROP POLICY IF EXISTS "read_companies" ON companies;
CREATE POLICY "read_companies" ON companies
  FOR SELECT USING (true);


-- ── 2. Company members table ──────────────────────────────────
-- Authoritative source for company assignment.
-- Only writable via service-role (admin Netlify functions) — never by the browser directly.
CREATE TABLE IF NOT EXISTS company_members (
  user_id    uuid REFERENCES auth.users NOT NULL,
  company_id uuid REFERENCES companies  NOT NULL,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

-- Users can read their own membership record only.
-- INSERT / UPDATE / DELETE is only possible via service role (admin Netlify functions).
DROP POLICY IF EXISTS "read_own_membership" ON company_members;
CREATE POLICY "read_own_membership" ON company_members
  FOR SELECT USING (auth.uid() = user_id);


-- ── 3. Add company_id to calls (if not already present) ───────
ALTER TABLE calls ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies;

-- Also add any columns added in previous sessions (safe no-ops if they exist):
ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_name    text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS albi_url         text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS contract_signed  text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS utm_source       text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS utm_medium       text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS utm_campaign     text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS utm_term         text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS gclid            text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS landing_page_url text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS referring_url    text;


-- ── 4. Security-definer helper — avoids RLS recursion ─────────
-- Runs as db owner so it can query company_members without going
-- through RLS on that table. Safe because it always filters by
-- auth.uid(), which cannot be spoofed by the calling user.
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT company_id
  FROM   company_members
  WHERE  user_id = auth.uid()
  LIMIT  1;
$$;


-- ── 5. Update calls RLS ────────────────────────────────────────
-- Drop the old per-user policy; replace with company-scoped policy.
-- Falls back to user_id ownership for old calls that pre-date company setup
-- (company_id IS NULL).  Tim should run the UPDATE below to migrate those.
DROP POLICY IF EXISTS "user_isolation"           ON calls;
DROP POLICY IF EXISTS "company_or_user_isolation" ON calls;

CREATE POLICY "company_or_user_isolation" ON calls
  FOR ALL
  USING (
    -- Any member of the company that owns the call can see it
    (company_id IS NOT NULL AND company_id = get_my_company_id())
    OR
    -- Personal / pre-migration calls: visible only to the user who created them
    (company_id IS NULL AND user_id = auth.uid())
  );


-- ── 6. Add company_id to user_settings (safe no-op) ──────────
-- No longer used for company assignment (company_members is authoritative),
-- but the column may already exist from a previous session so we keep it.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies;


-- =============================================================
-- INITIAL SETUP FOR TIM — run AFTER the schema above
-- Replace the placeholder values with your real data.
-- =============================================================

-- Step A: Create your company
-- INSERT INTO companies (name)
-- VALUES ('Allied Restoration Services')
-- ON CONFLICT (name) DO NOTHING;

-- Step B: Find your Supabase user ID
-- SELECT id, email FROM auth.users WHERE email = 'your@email.com';

-- Step C: Add yourself as admin (replace USER_UUID and COMPANY_NAME)
-- INSERT INTO company_members (user_id, company_id, role)
-- SELECT
--   'YOUR-USER-UUID-HERE',          -- paste from Step B
--   id,
--   'admin'
-- FROM companies
-- WHERE name = 'Allied Restoration Services'
-- ON CONFLICT DO NOTHING;

-- Step D: Backfill company_id on your existing calls so teammates can see them
-- UPDATE calls
-- SET company_id = (
--   SELECT id FROM companies WHERE name = 'Allied Restoration Services'
-- )
-- WHERE user_id  = 'YOUR-USER-UUID-HERE'
--   AND company_id IS NULL;
