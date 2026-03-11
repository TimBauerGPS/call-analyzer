-- ============================================================
-- 006_user_partners.sql
--
-- Adds multi-company (partner) support for the master user.
-- Each row represents one partner company the master user
-- manages, with its own CallRail credentials.
-- The master user's OpenAI key stays in user_settings.
--
-- Also adds partner_company column to calls so calls can be
-- tagged with which partner they came from and filtered.
-- ============================================================

-- Partner company profiles (one per CallRail account)
CREATE TABLE IF NOT EXISTS user_partners (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name        text NOT NULL,
  callrail_api_key    text,
  callrail_account_id text,
  display_order       int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_name)
);

ALTER TABLE user_partners ENABLE ROW LEVEL SECURITY;

-- Only the owner can see and manage their own partner profiles
CREATE POLICY "owner_only_partners" ON user_partners
  FOR ALL
  USING (user_id = auth.uid());

-- Tag calls with which partner company they came from (nullable — no effect on existing rows)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS partner_company text;

-- Index for efficient partner filtering
CREATE INDEX IF NOT EXISTS calls_partner_company_idx ON calls(partner_company);
