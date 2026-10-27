-- Milestone M4, Phase B: watches + change-event projection (ADR 0077).
--
-- Builds the monitoring engine's storage on top of the Phase A account foundation (0124):
--   * watch        -- a principal follows an entity or a saved search
--   * saved_search -- a stored query a watch can point at
--   * change_event -- the durable, append-only stream of "something changed on a subject",
--                     derived (in app code) from the existing ingestion outbox + deterministic
--                     status transitions. Alerts fan out FROM this stream to watchers.
--
-- change_event carries a UNIQUE dedup_key so the projection is idempotent: re-deriving events
-- from the same underlying court record never produces a duplicate alert. Nothing here touches
-- the public legal-record tables; a change_event only *references* a subject.

BEGIN;

CREATE TYPE watch_target_type AS ENUM (
  'case', 'party', 'organization', 'attorney', 'law_firm', 'judge', 'court', 'topic', 'saved_search'
);
-- Mirrors AlertCadence in src/modules/accounts/domain/entitlements.ts. Which cadences a principal
-- may actually choose is enforced in app code from their plan entitlements, not by this type.
CREATE TYPE alert_cadence AS ENUM ('weekly', 'daily', 'immediate');

CREATE TABLE saved_search (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES account_principal(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_search_principal_idx ON saved_search (principal_id);

CREATE TABLE watch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES account_principal(id) ON DELETE CASCADE,
  target_type watch_target_type NOT NULL,
  -- Opaque reference to the followed subject: an entity's uuid as text, a topic slug, or a
  -- saved_search id. Kept as text so one table follows every subject kind uniformly.
  target_ref text NOT NULL,
  label text,
  cadence alert_cadence NOT NULL DEFAULT 'weekly',
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, target_type, target_ref)
);

CREATE INDEX watch_principal_idx ON watch (principal_id);
CREATE INDEX watch_target_idx ON watch (target_type, target_ref) WHERE NOT muted;

CREATE TABLE change_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type watch_target_type NOT NULL,
  subject_ref text NOT NULL,
  kind text NOT NULL,
  -- Idempotency key: deterministic in the underlying court record, so the projection can be
  -- re-run safely. A duplicate derivation hits this UNIQUE and is skipped.
  dedup_key text NOT NULL UNIQUE,
  headline text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_label text,
  rule_version text,
  occurred_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fan-out lookup (events for a followed subject, newest first) and digest windows (events since).
CREATE INDEX change_event_subject_idx ON change_event (subject_type, subject_ref, created_at DESC);
CREATE INDEX change_event_created_idx ON change_event (created_at DESC);

COMMIT;
