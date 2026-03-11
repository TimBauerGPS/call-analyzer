-- ============================================================
-- 007_master_admin.sql
--
-- Adds is_master_admin flag to user_settings.
-- Master admins manage multiple partner companies, each with
-- their own CallRail credentials, and a single shared OpenAI key.
--
-- To promote a user:
--   INSERT INTO user_settings (user_id, is_master_admin)
--   VALUES ('<their-uuid>', true)
--   ON CONFLICT (user_id) DO UPDATE SET is_master_admin = true;
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS is_master_admin boolean NOT NULL DEFAULT false;
