-- Judge, court, party, and topic follows fan out to many cases. Those stay
-- stored for free accounts but stop refreshing and stop emailing until the
-- account is on Plus, Pro, or Team. Nothing is deleted. Case follows and
-- emergency-docket follows are unchanged. Stripe is not involved.

ALTER TABLE entity_follow
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE entity_follow DROP CONSTRAINT IF EXISTS entity_follow_status_check;
ALTER TABLE entity_follow ADD CONSTRAINT entity_follow_status_check
  CHECK (status IN ('active', 'needs_upgrade'));

UPDATE entity_follow f
SET status = 'needs_upgrade', updated_at = now()
WHERE f.kind IN ('judge', 'court', 'party', 'topic')
  AND f.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM account_subscription s
    WHERE s.user_id = f.user_id
      AND s.plan IN ('plus', 'pro', 'team')
      AND s.status IN ('active', 'trialing', 'past_due')
  );
