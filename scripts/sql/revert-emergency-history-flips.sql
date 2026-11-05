-- One-off: put history rows the live lane re-read back into source_lane 'history'.
--
-- Backfill 41970173942 loaded the 2017-2026 history in one load at
-- 2026-11-05 04:50:40-04:50:48 UTC (rows got first_seen_at = that load; their
-- docket lines were inserted backfilled with detected_at = that load). Before
-- PR #702 the 10-minute lane re-polled some of those rows and its upsert set
-- source_lane = 'live', pulling old dockets into the public list.
--
-- A row is reverted only if it is live now, it was first seen inside that load
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
CREATE TEMP TABLE flip ON COMMIT DROP AS
SELECT a.docket_number, a.kind, a.status, a.withheld_lines, a.first_seen_at
FROM scotus_application a
WHERE a.source_lane = 'live'
  AND a.first_seen_at >= timestamptz '2026-11-05 04:50:30+00' AND a.first_seen_at < timestamptz '2026-11-05 04:51:00+00'
  AND a.docket_number ~ '^(1[7-9]|2[0-6])A[0-9]{1,4}$'
  AND EXISTS (SELECT 1 FROM scotus_application_event e WHERE e.docket_number = a.docket_number AND e.backfilled
    AND e.detected_at >= timestamptz '2026-11-05 04:50:30+00' AND e.detected_at < timestamptz '2026-11-05 04:51:00+00');
SELECT 'lane_counts_before', source_lane, count(*) AS rows, count(*) FILTER (WHERE kind <> 'extension') AS serious FROM scotus_application GROUP BY source_lane ORDER BY 2;
SELECT 'candidates', count(*) AS rows, count(*) FILTER (WHERE withheld_lines > 0) AS with_withheld_lines_skipped FROM flip;
SELECT 'candidate_by_year', substring(docket_number FROM 1 FOR 3) AS year, count(*) FROM flip GROUP BY 2 ORDER BY 2;
SELECT 'candidate', docket_number, kind, status, withheld_lines, first_seen_at FROM flip ORDER BY substring(docket_number FROM 1 FOR 2), substring(docket_number FROM 4)::int;
DO $$ BEGIN
  IF (SELECT count(*) FROM flip) > 200 THEN RAISE EXCEPTION 'refusing: % candidates is more than the expected ~30', (SELECT count(*) FROM flip); END IF;
END $$;
\if :apply
UPDATE scotus_application a SET source_lane = 'history'
FROM flip f WHERE a.docket_number = f.docket_number AND f.withheld_lines = 0 AND a.source_lane = 'live';
SELECT 'lane_counts_after', source_lane, count(*) AS rows, count(*) FILTER (WHERE kind <> 'extension') AS serious FROM scotus_application GROUP BY source_lane ORDER BY 2;
COMMIT;
SELECT 'applied';
\else
ROLLBACK;
SELECT 'dry run: nothing changed';
\endif
