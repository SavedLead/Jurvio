-- Owner "new sign-up" email dedupe: set once when the notification is claimed
-- (live sign-up path or the one-off backfill for pre-existing accounts).
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS signup_notified_at timestamptz;
