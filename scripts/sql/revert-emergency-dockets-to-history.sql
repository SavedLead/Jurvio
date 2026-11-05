-- One-off: move an explicit list of flipped emergency dockets back to
-- source_lane 'history' (decision Nov 5, 3:49 AM ET). Only source_lane changes:
-- no timestamps, no lines, nothing read or published. A listed docket is moved
-- only if it is live now, from docket years 17A-25A, and was created by the
-- history load (first_seen_at in the 2026-11-05 04:50:30-04:51:00 UTC window).
-- Idempotent. Dry run unless -v apply=1. Requires -v dockets='22A226,23A177'.
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE listed ON COMMIT DROP AS
SELECT DISTINCT trim(d) AS docket_number FROM unnest(string_to_array(:'dockets', ',')) d WHERE trim(d) <> '';
DO $$ BEGIN
  IF (SELECT count(*) FROM listed) = 0 OR (SELECT count(*) FROM listed) > 10 THEN RAISE EXCEPTION 'list 1-10 dockets'; END IF;
  IF EXISTS (SELECT 1 FROM listed WHERE docket_number !~ '^(1[7-9]|2[0-5])A[0-9]{1,4}$') THEN RAISE EXCEPTION 'only 17A-25A dockets'; END IF;
END $$;
CREATE TEMP TABLE flip ON COMMIT DROP AS
SELECT a.docket_number FROM scotus_application a JOIN listed l USING (docket_number)
WHERE a.source_lane = 'live'
  AND a.first_seen_at >= timestamptz '2026-11-05 04:50:30+00' AND a.first_seen_at < timestamptz '2026-11-05 04:51:00+00';
SELECT 'lane_counts_before', source_lane, count(*) AS rows, count(*) FILTER (WHERE kind <> 'extension') AS serious,
  count(*) FILTER (WHERE kind <> 'extension' AND status = 'pending') AS pending_serious FROM scotus_application GROUP BY source_lane ORDER BY 2;
SELECT 'listed', l.docket_number, coalesce(a.source_lane, 'missing') AS lane, a.kind, a.status,
  CASE WHEN f.docket_number IS NOT NULL THEN 'MOVE TO HISTORY'
       WHEN a.docket_number IS NULL THEN 'skip: no such row'
       WHEN a.source_lane = 'history' THEN 'skip: already history'
       ELSE 'skip: not created by the history load' END AS action
FROM listed l LEFT JOIN scotus_application a USING (docket_number) LEFT JOIN flip f USING (docket_number)
ORDER BY l.docket_number;
\if :apply
UPDATE scotus_application a SET source_lane = 'history' FROM flip f WHERE a.docket_number = f.docket_number AND a.source_lane = 'live';
SELECT 'lane_counts_after', source_lane, count(*) AS rows, count(*) FILTER (WHERE kind <> 'extension') AS serious,
  count(*) FILTER (WHERE kind <> 'extension' AND status = 'pending') AS pending_serious FROM scotus_application GROUP BY source_lane ORDER BY 2;
COMMIT;
SELECT 'applied';
\else
ROLLBACK;
SELECT 'dry run: nothing changed';
\endif
