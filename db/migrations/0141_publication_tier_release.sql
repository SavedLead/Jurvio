-- Ledger for the tiered publishing plan (Tier 1 + Tier 2 release, David Rosenberg 2026-10-30).
-- One row per case the tier releaser staged. It records the state the case had before
-- release and the publication_decision the release wrote, so a release can be undone
-- exactly: restore prior_publication and delete decision_id (the publication_decision
-- delete trigger recomputes publication_current). scripts/ops/publish-tiers-1-2.sql
-- also runs this DDL (IF NOT EXISTS) so the releaser does not wait on a deploy.
CREATE TABLE IF NOT EXISTS publication_tier_release (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 4),
  run_id text NOT NULL,
  prior_publication publication_state NOT NULL,
  decision_id uuid,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'skipped', 'reverted')),
  skip_reason text,
  staged_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  reverted_at timestamptz
);

CREATE INDEX IF NOT EXISTS publication_tier_release_run_state_idx
  ON publication_tier_release (run_id, state, tier);
