-- =============================================================
-- Migration 005: Company Settings
-- Moves API keys from per-user to per-company storage.
-- Members cannot read or write this table — only admins and
-- super admins can. The Netlify functions read it via service
-- role so members can still use the app normally.
-- =============================================================

CREATE TABLE IF NOT EXISTS company_settings (
  company_id           uuid REFERENCES companies PRIMARY KEY,
  callrail_api_key     text,
  callrail_account_id  text,
  openai_api_key       text,
  updated_at           timestamptz DEFAULT now()
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

-- Company admins and super admins can read and write their company's settings.
-- Members have NO access — intentional. API keys are admin-only.
DROP POLICY IF EXISTS "admin_manage_company_settings" ON company_settings;
CREATE POLICY "admin_manage_company_settings" ON company_settings
  FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM company_members
      WHERE user_id    = auth.uid()
        AND company_id = company_settings.company_id
        AND role       = 'admin'
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM company_members
      WHERE user_id    = auth.uid()
        AND company_id = company_settings.company_id
        AND role       = 'admin'
    )
  );


-- =============================================================
-- MIGRATION STEP FOR TIM — run after the schema above
-- Copies your existing API keys from user_settings into the
-- new company_settings table so nothing breaks immediately.
-- Replace 'YOUR-COMPANY-UUID-HERE' with your company's UUID:
--   SELECT id, name FROM companies;
-- =============================================================

-- INSERT INTO company_settings (company_id, callrail_api_key, callrail_account_id, openai_api_key)
-- SELECT
--   'YOUR-COMPANY-UUID-HERE',
--   callrail_api_key,
--   callrail_account_id,
--   openai_api_key
-- FROM user_settings
-- WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your@email.com')
-- ON CONFLICT (company_id) DO NOTHING;
