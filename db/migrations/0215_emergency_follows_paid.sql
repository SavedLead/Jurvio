-- Emergency-docket follows watch many applications. They stay stored for
-- free accounts but stop refreshing and stop emailing until the account is
-- on Plus, Pro, or Team. Nothing is deleted. A follow of one case is unchanged.

UPDATE entity_follow f
SET status = 'needs_upgrade', updated_at = now()
WHERE f.kind = 'emergency'
  AND f.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM account_subscription s
    WHERE s.user_id = f.user_id
      AND s.plan IN ('plus', 'pro', 'team')
      AND s.status IN ('active', 'trialing', 'past_due')
  );
