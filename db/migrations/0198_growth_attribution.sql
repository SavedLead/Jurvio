-- Growth attribution (first-touch). A human visitor's first public page view
-- stores referrer host, landing path and utm tags in a first-party cookie and
-- one row here. No IP, user agent or stable visitor id is stored.
CREATE TABLE IF NOT EXISTS visitor_first_touch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  referrer_host text CHECK (referrer_host IS NULL OR length(referrer_host) <= 255),
  landing_path text NOT NULL CHECK (length(landing_path) BETWEEN 1 AND 300),
  utm_source text CHECK (utm_source IS NULL OR length(utm_source) <= 100),
  utm_medium text CHECK (utm_medium IS NULL OR length(utm_medium) <= 100),
  utm_campaign text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 100)
);
CREATE INDEX IF NOT EXISTS visitor_first_touch_time_idx ON visitor_first_touch (occurred_at);

-- One row per sign-in request (no email): where it started and the visitor's first touch.
CREATE TABLE IF NOT EXISTS signin_request_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL,
  source text,
  signin_from_path text CHECK (signin_from_path IS NULL OR length(signin_from_path) <= 300)
);
CREATE INDEX IF NOT EXISTS signin_request_event_time_idx ON signin_request_event (occurred_at);

-- First-touch attribution saved on the account at creation (first sign-in).
CREATE TABLE IF NOT EXISTS signup_attribution (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  source text,
  referrer_host text,
  landing_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  first_touch_at timestamptz,
  signin_from_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Carry attribution from the sign-in request to account creation, and onto waitlist leads.
ALTER TABLE auth_login_token ADD COLUMN IF NOT EXISTS attribution jsonb;
ALTER TABLE lead_waitlist ADD COLUMN IF NOT EXISTS attribution jsonb;

CREATE INDEX IF NOT EXISTS app_user_created_idx ON app_user (created_at);
CREATE INDEX IF NOT EXISTS lead_waitlist_created_idx ON lead_waitlist (created_at);
CREATE INDEX IF NOT EXISTS case_follow_user_created_idx ON case_follow (user_id, created_at);
