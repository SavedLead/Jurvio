BEGIN;

ALTER TABLE internal_user
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS internal_session (
  token_hash text PRIMARY KEY,
  internal_user_id uuid NOT NULL REFERENCES internal_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_session_expiry_idx
  ON internal_session (expires_at);

CREATE TABLE IF NOT EXISTS internal_login_attempt (
  email text NOT NULL,
  ip_hash text NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, ip_hash)
);

INSERT INTO internal_user (email, role, active, password_hash)
VALUES (
  'david@cleanyourname.com',
  'administrator',
  true,
  'scrypt$3Ms7PY7D5dwda7s_muc6XQ$pEt5MKWXrF8-skanb3jS_4UtaFFH7CXNSZDPuX-Sppbq8zG9JBetSQvYVqUtQHx6-CWxFJPXRSNEd9_66RkFbQ'
)
ON CONFLICT (email) DO UPDATE
SET role = EXCLUDED.role,
    active = true,
    password_hash = EXCLUDED.password_hash,
    updated_at = now();

COMMIT;
