-- Customer accounts, passwordless email sign-in, case follows and plans
-- (subscriptions Phase 1; David Rosenberg, 2026-11-01).
--
-- Security rules for this schema:
-- * No passwords and no secrets in this file or any later migration. Accounts
--   are created only by the sign-in flow at runtime, never seeded here (unlike
--   the internal admin bootstrap in 0101, which must not be copied).
-- * Magic-link tokens and session tokens are stored only as SHA-256 hashes.
--   The raw value exists only in the email link / httpOnly cookie.
-- * Rate-limit buckets store a hash of the email or IP, not the raw value.
-- * Stripe ids are nullable: billing is off until Stripe is configured, and
--   Stripe is billing authority while account_subscription is the product-access
--   projection (docs/16 section 5).
-- Plan prices and limits live in src/modules/accounts/domain/plans.ts, not here.

DO $$ BEGIN
  CREATE TYPE account_plan AS ENUM ('free', 'plus', 'pro', 'team');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  email_verified_at timestamptz,
  -- Random opaque value used only in unsubscribe links (never a session).
  unsubscribe_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  alerts_unsubscribed_at timestamptz,
  last_digest_at timestamptz,
  last_signed_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email),
  UNIQUE (unsubscribe_token)
);

-- Single-use magic-link tokens (about 15 minutes). The intent columns let a
-- "Follow this case" sign-in finish the follow after the link is opened.
CREATE TABLE IF NOT EXISTS auth_login_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  email text NOT NULL CHECK (email = lower(email)),
  redirect_path text CHECK (redirect_path IS NULL OR (left(redirect_path, 1) = '/' AND left(redirect_path, 2) <> '//')),
  follow_case_public_id text,
  requested_ip_hash text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_login_token_email_created_idx ON auth_login_token (email, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_login_token_expires_idx ON auth_login_token (expires_at);

CREATE TABLE IF NOT EXISTS auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session (user_id);
CREATE INDEX IF NOT EXISTS auth_session_expires_idx ON auth_session (expires_at);

-- Fixed-window counters for sign-in requests, keyed by hashed email or IP.
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  bucket text NOT NULL CHECK (bucket IN ('signin_email', 'signin_ip')),
  key_hash text NOT NULL CHECK (length(key_hash) = 64),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (bucket, key_hash)
);

CREATE TABLE IF NOT EXISTS case_follow (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  -- Alert watermark: docket entries created after this are "new" for this follow.
  last_alerted_entry_created_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, case_id)
);
CREATE INDEX IF NOT EXISTS case_follow_case_idx ON case_follow (case_id);

-- One current plan row per user. No row means free.
CREATE TABLE IF NOT EXISTS account_subscription (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  plan account_plan NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused')),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Verified, idempotent Stripe webhook inbox (unused until Stripe is configured).
CREATE TABLE IF NOT EXISTS stripe_webhook_event (
  id text PRIMARY KEY,
  type text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

-- "Coming soon / join waitlist" interest from the pricing page.
CREATE TABLE IF NOT EXISTS plan_waitlist (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plan account_plan NOT NULL CHECK (plan <> 'free'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plan)
);

-- Outbound email log (sign-in links and alert digests). The address is kept
-- only through user_id; sign-in mail to an address with no account yet stores
-- a hash.
CREATE TABLE IF NOT EXISTS email_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  email_hash text CHECK (email_hash IS NULL OR length(email_hash) = 64),
  kind text NOT NULL CHECK (kind IN ('signin_link', 'alert_digest')),
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_message_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_event_user_created_idx ON email_event (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_event_created_idx ON email_event (created_at DESC);
