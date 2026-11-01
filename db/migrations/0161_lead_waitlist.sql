-- No-sign-in lead capture (front-end audit P0, 2026-11-01).
--
-- While production has no email provider, "Follow this case", the /pricing
-- waitlist buttons, "Get started free" and /signin store the visitor's email
-- here instead of dead-ending on "Sign-in is temporarily unavailable". When
-- the visitor later signs in with the same address, waitlisted case follows
-- become real follows and plan interest moves into plan_waitlist
-- (converted_at / converted_user_id record that).
--
-- * The raw email is kept because it is the only way to tell the visitor
--   alerts are live. The IP is stored only as a SHA-256 hash.
-- * One row per (email, source, case, plan); repeats bump last_seen_at.

CREATE TABLE IF NOT EXISTS lead_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  source text NOT NULL CHECK (source IN ('case_follow', 'plan', 'signin')),
  case_public_id text CHECK (case_public_id IS NULL OR case_public_id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  plan account_plan,
  ip_hash text CHECK (ip_hash IS NULL OR length(ip_hash) = 64),
  submissions integer NOT NULL DEFAULT 1 CHECK (submissions >= 1),
  converted_at timestamptz,
  converted_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source <> 'case_follow' OR case_public_id IS NOT NULL),
  CHECK (source <> 'plan' OR plan IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_waitlist_dedupe_idx
  ON lead_waitlist (email, source, coalesce(case_public_id, ''), coalesce(plan, 'free'::account_plan));
CREATE INDEX IF NOT EXISTS lead_waitlist_unconverted_idx ON lead_waitlist (email) WHERE converted_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_waitlist_created_idx ON lead_waitlist (created_at DESC);

-- Waitlist submissions share the fixed-window limiter with sign-in.
ALTER TABLE auth_rate_limit DROP CONSTRAINT IF EXISTS auth_rate_limit_bucket_check;
ALTER TABLE auth_rate_limit ADD CONSTRAINT auth_rate_limit_bucket_check
  CHECK (bucket IN ('signin_email', 'signin_ip', 'waitlist_email', 'waitlist_ip'));

-- The audit's single test submission (2026-11-01) must not be kept anywhere.
DELETE FROM lead_waitlist WHERE email = 'audit-test@example.com';
DELETE FROM auth_login_token WHERE email = 'audit-test@example.com';
DELETE FROM app_user WHERE email = 'audit-test@example.com';
