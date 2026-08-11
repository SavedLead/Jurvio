-- Scheduler lane self-detection.
--
-- The on-box scheduler (scripts/run-production-scheduler.ts) spawns each ingestion
-- lane as a child process. Until now a lane that exited non-zero -- e.g. the
-- scotus-enriched lane crashing on an over-large `--limit=300` before any work ran
-- -- left only a line in a per-lane log file that nothing reads. The platform had
-- no durable, queryable signal that a lane was failing, so a crash-looping lane
-- could publish nothing for days without the autopilot noticing.
--
-- This table records the outcome of every lane run. The supervisor reads it each
-- tick to detect a persistently-failing lane and record an ingestion_repair_action;
-- read-only status reports can render a per-lane health matrix from it.

CREATE TABLE IF NOT EXISTS scheduler_lane_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane text NOT NULL,                       -- job name, e.g. 'scotus-enriched'
  scheduler_lane text NOT NULL,             -- 'core' | 'coa'
  command text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  exit_code integer,                        -- null when the child died on a signal / spawn error
  signal text,
  ok boolean NOT NULL DEFAULT false,        -- true only on a clean exit_code = 0
  error_tail text                           -- trailing child stderr/stdout captured on failure
);

-- Most-recent run per lane (health matrix) and a global recent feed.
CREATE INDEX IF NOT EXISTS scheduler_lane_run_lane_time_idx
  ON scheduler_lane_run (lane, started_at DESC);
CREATE INDEX IF NOT EXISTS scheduler_lane_run_recent_idx
  ON scheduler_lane_run (started_at DESC);
