-- One-off: put history rows the live lane re-read back into source_lane 'history'.
--
-- Backfill 41970173942 loaded the 2017-2026 history in one load at
-- 2026-11-05 04:50:40-04:50:48 UTC (rows got first_seen_at = that load; their
-- docket lines were inserted backfilled with detected_at = that load). Before
-- PR #702 the 10-minute lane re-polled some of those rows and its upsert set
-- source_lane = 'live', pulling old dockets into the public list.
--
-- (Original rule, narrowed below by Option A.) A row is reverted only if it is live now, it was first seen inside that load
-- window, and it has backfilled lines detected inside the same window (so the
-- history load created it). Rows with withheld (sealed/restricted) lines are
-- listed and never touched. Only source_lane changes: no timestamps, no other
-- columns. Idempotent: a second run finds nothing. Dry run unless -v apply=1.
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '10s';
-- Option A (Nov 5): only genuinely old dockets go back to history. Docket years
-- 17A-24A, plus decided 25A; pending 25A and every 26A (current term) stay live.
CREATE TEMP TABLE flipped ON COMMIT DROP AS
SELECT a.docket_number, a.kind, a.status, a.withheld_lines, a.entry_count, a.first_seen_at,
  substring(a.docket_number FROM 1 FOR 2)::int AS yy
FROM scotus_application a
WHERE a.source_lane = 'live'
  AND a.first_seen_at >= timestamptz '2026-11-05 04:50:30+00' AND a.first_seen_at < timestamptz '2026-11-05 04:51:00+00'
  AND a.docket_number ~ '^(1[7-9]|2[0-6])A[0-9]{1,4}$';
CREATE TEMP TABLE flip ON COMMIT DROP AS
SELECT * FROM flipped
WHERE (yy <= 24 OR (yy = 25 AND status <> 'pending')) AND withheld_lines = 0;
SELECT 'lane_counts_before', source_lane, count(*) AS rows, count(*) FILTER (WHERE kind <> 'extension') AS serious FROM scotus_application GROUP BY source_lane ORDER BY 2;
SELECT 'flipped_total', count(*) FROM flipped;
SELECT 'row', f.docket_number, f.kind, f.status, f.withheld_lines, f.entry_count,
  CASE WHEN f.docket_number IN (SELECT docket_number FROM flip) THEN 'REVERT'
       WHEN f.withheld_lines > 0 AND (f.yy <= 24 OR (f.yy = 25 AND f.status <> 'pending')) THEN 'skip: withheld lines'
       ELSE 'keep live: current or pending' END AS action
FROM flipped f ORDER BY f.yy, substring(f.docket_number FROM 4)::int;
SELECT 'candidates', count(*) AS rows, count(*) FILTER (WHERE status = 'pending') AS still_pending FROM flip;
DO $$ BEGIN
  IF (SELECT count(*) FROM flip) > 20 THEN RAISE EXCEPTION 'refusing: % candidates, expected about 6', (SELECT count(*) FROM flip); END IF;
END $$;
\if :apply
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM flip WHERE status = 'pending') THEN RAISE EXCEPTION 'refusing to apply: a selected row is not decided'; END IF;
END $$;
UPDATE scotus_application a SET source_lane = 'history'
FROM flip f WHERE a.docket_number = f.docket_number AND f.withheld_lines = 0 AND a.source_lane = 'live';
SELECT 'lane_counts_after', source_lane, count(*) AS rows, count(*) FILTER (WHERE kind <> 'extension') AS serious FROM scotus_application GROUP BY source_lane ORDER BY 2;
COMMIT;
SELECT 'applied';
\else
ROLLBACK;
SELECT 'dry run: nothing changed';
\endif
