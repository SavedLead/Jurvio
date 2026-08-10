-- Durable, server-resident ingestion agent platform.
--
-- A PostgreSQL-backed job queue with worker leases, a supervisor audit/repair
-- log, and per-source operating policy. This gives ingestion jobs durable state
-- that survives worker restarts and server reboots, so the platform keeps
-- running after any Claude Code session closes. It augments (does not delete)
-- the existing in-process scheduler; jobs migrate onto this queue incrementally.

CREATE TABLE IF NOT EXISTS ingestion_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  court_code text,
  partition text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts >= 1),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  -- Idempotency: a stable key (kind:court:partition) so re-enqueues never
  -- duplicate an outstanding unit of work.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);

-- Claimable work, ordered by priority then eligibility. Partial index keeps the
-- hot path small even when the table holds a large completed history.
CREATE INDEX IF NOT EXISTS ingestion_job_claimable_idx
  ON ingestion_job (priority, run_after)
  WHERE status = 'pending';

-- Expired leases the supervisor reaps back to pending.
CREATE INDEX IF NOT EXISTS ingestion_job_lease_idx
  ON ingestion_job (lease_expires_at)
  WHERE status = 'leased';

-- Per-worker liveness so the supervisor can detect crashed/stalled workers.
CREATE TABLE IF NOT EXISTS ingestion_worker_heartbeat (
  worker_id text PRIMARY KEY,
  lane text NOT NULL,
  status text NOT NULL DEFAULT 'alive',
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Append-only audit of every automatic repair: what was detected, what action
-- was taken, why, and the outcome. Never silently repairs.
CREATE TABLE IF NOT EXISTS ingestion_repair_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detector text NOT NULL,
  subject text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  outcome text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ingestion_repair_action_time_idx
  ON ingestion_repair_action (occurred_at DESC);

-- Operating policy per source (optionally per court). The supervisor may pause
-- or mark a source under review; it may never enable a paid source.
CREATE TABLE IF NOT EXISTS ingestion_source_policy (
  source_code text NOT NULL,
  court_code text NOT NULL DEFAULT '*',
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'paused', 'under_review', 'unavailable')),
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_code, court_code)
);
