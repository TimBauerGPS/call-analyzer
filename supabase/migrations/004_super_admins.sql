-- =============================================================
-- Migration 004: Super Admins (cross-company management)
-- Run in Supabase SQL Editor after 003_company_members.sql
-- =============================================================

-- Super admins can manage ALL companies — create companies, invite
-- users to any company, and see all members across the board.
-- Regular company admins can only manage their own company.

CREATE TABLE IF NOT EXISTS super_admins (
  user_id    uuid REFERENCES auth.users PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- Users can read their own row only (used by the client to show/hide admin UI).
DROP POLICY IF EXISTS "read_own_super_admin" ON super_admins;
CREATE POLICY "read_own_super_admin" ON super_admins
  FOR SELECT USING (auth.uid() = user_id);

-- Security-definer helper — called from RLS policies on other tables
-- without triggering recursive RLS on super_admins itself.
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM super_admins WHERE user_id = auth.uid()
  );
$$;


-- =============================================================
-- INITIAL SETUP — run after the schema above
-- Replace 'YOUR-USER-UUID-HERE' with Tim's actual user ID.
-- =============================================================

-- Step A: Find your user ID
-- SELECT id, email FROM auth.users WHERE email = 'your@email.com';

-- Step B: Add yourself as super admin
-- INSERT INTO super_admins (user_id)
-- VALUES ('YOUR-USER-UUID-HERE')
-- ON CONFLICT DO NOTHING;
