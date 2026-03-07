-- =============================================================
-- Call Analyzer — Supabase Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New Query)
-- =============================================================

-- Calls table
-- Stores one row per CallRail call per user.
-- RLS ensures each user can only see their own data.
CREATE TABLE IF NOT EXISTS calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users NOT NULL,

  -- CallRail metadata
  callrail_id       text NOT NULL,
  caller_number     text,
  call_date         timestamptz,
  duration_seconds  integer,
  source            text,
  recording_url     text,

  -- Full transcript (Whisper or GPT-4o Audio)
  transcript        text,

  -- Job matching (from uploaded CSV)
  job_id            text,
  job_type          text,
  job_status        text,

  -- Standard analysis fields (matches reference Apps Script output)
  handler_name      text,
  viable_lead       text,       -- 'Yes' | 'No' | 'Unknown'
  introduced        boolean,
  scheduled         boolean,
  cb_requested      boolean,
  notes             text,
  sales_tips        text,

  -- Deep analysis fields (GPT-4o Audio only)
  tonal_feedback    text,
  talk_time_ratio   text,

  -- Additional analysis fields (from brief)
  is_ppc            boolean,
  was_booked        boolean,
  sentiment         text,
  sentiment_score   integer,    -- 0-100
  coaching_tips     jsonb,      -- string[]
  missed_flags      jsonb,      -- string[]

  -- Pipeline state
  analysis_status   text DEFAULT 'pending',  -- pending | processing | complete | error
  analysis_tier     text,                    -- 'standard' | 'deep'

  created_at        timestamptz DEFAULT now()
);

-- Unique constraint: one row per (user, call) — enables safe upsert
CREATE UNIQUE INDEX IF NOT EXISTS calls_user_callrail_idx ON calls (user_id, callrail_id);

-- RLS
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_isolation" ON calls
  FOR ALL
  USING (auth.uid() = user_id);


-- =============================================================
-- User settings
-- Each user stores their own API keys here.
-- Keys are fetched server-side by Netlify functions using the service role key —
-- they never travel from browser to function directly.
-- =============================================================
CREATE TABLE IF NOT EXISTS user_settings (
  user_id               uuid PRIMARY KEY REFERENCES auth.users,
  -- API credentials (per-user, each office has their own accounts)
  callrail_api_key      text,
  callrail_account_id   text,
  openai_api_key        text,
  -- Configurable sales analysis prompt
  sales_tips_prompt     text
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_isolation" ON user_settings
  FOR ALL
  USING (auth.uid() = user_id);
