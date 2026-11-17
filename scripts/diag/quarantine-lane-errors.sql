-- Read-only: recent publication-quarantine runs and the scheduler lane that
-- launches them. Error text only. No captions, docket numbers, or names.
\pset pager off
\x on

\echo == publication-quarantine runs
SELECT id,
  status::text AS status,
  started_at,
  completed_at,
  records_seen,
  records_changed,
  succeeded_count,
  failed_count,
  error::text AS error_text,
  selection::text AS selection_text
FROM ingestion_run
WHERE run_type = 'publication-quarantine'
ORDER BY started_at DESC
LIMIT 10;

\echo == federal-publication lane outcomes
SELECT started_at,
  finished_at,
  duration_ms,
  exit_code,
  signal,
  ok,
  error_tail
FROM scheduler_lane_run
WHERE lane = 'federal-publication'
ORDER BY started_at DESC
LIMIT 10;
