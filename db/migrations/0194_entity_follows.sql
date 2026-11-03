-- Judge, topic and party follows ("alerts"), approved by the owner 2026-11-02.
--
-- entity_follow: one row per (user, kind, target). target_key is
--   judge  -> judge.public_id
--   topic  -> a topic slug from src/modules/accounts/domain/topics.ts
--             (nature-of-suit groups; the catalog lives in code, not here)
--   party  -> entity.normalized_name (so every source identity with the same
--             normalized name matches)
-- frequency: 'asap' = sent on the next 10-minute alert tick after a match is
-- found (courts are checked on their own schedules; copy never says
-- "instant"), 'daily' = one digest a day.
-- Per-plan limits live in src/modules/accounts/domain/plans.ts.
--
-- entity_alert_item: a match the alert job found, with a public-safe summary
-- written at match time (never non-public docket text). Kept one row per
-- (follow, item) so a match is never sent twice. sent_at NULL = queued.
--
-- entity_alert_cursor: how far the match job has scanned each event source.
--
-- The BRIN indexes let the job read only the newest rows of docket_entry and
-- document by created_at (both are append-mostly). BRIN is small and is built
-- CONCURRENTLY, so ingestion writes are not blocked while it builds.

CREATE TABLE IF NOT EXISTS entity_follow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('judge', 'topic', 'party')),
  target_key text NOT NULL CHECK (length(target_key) BETWEEN 1 AND 300),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 300),
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('asap', 'daily')),
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, target_key)
);
CREATE INDEX IF NOT EXISTS entity_follow_kind_target_idx ON entity_follow (kind, target_key);

CREATE TABLE IF NOT EXISTS entity_alert_item (
  follow_id uuid NOT NULL REFERENCES entity_follow(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 3 AND 120),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK (event_kind IN ('new_case', 'docket_entry', 'decision')),
  occurred_on date,
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 400),
  found_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (follow_id, item_key)
);
CREATE INDEX IF NOT EXISTS entity_alert_item_unsent_idx ON entity_alert_item (follow_id, found_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS entity_alert_item_recent_idx ON entity_alert_item (follow_id, found_at DESC);

CREATE TABLE IF NOT EXISTS entity_alert_cursor (
  source text PRIMARY KEY CHECK (source IN ('docket_entry', 'document', 'legal_case', 'judge_case_assignment')),
  scanned_to timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO entity_alert_cursor (source, scanned_to)
VALUES ('docket_entry', now()), ('document', now()), ('legal_case', now()), ('judge_case_assignment', now())
ON CONFLICT (source) DO NOTHING;

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS docket_entry_created_brin_idx
  ON docket_entry USING brin (created_at) WITH (pages_per_range = 32);

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS document_created_brin_idx
  ON document USING brin (created_at) WITH (pages_per_range = 32);

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS judge_case_assignment_created_brin_idx
  ON judge_case_assignment USING brin (created_at) WITH (pages_per_range = 32);
