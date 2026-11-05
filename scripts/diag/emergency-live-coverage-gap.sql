-- Read-only: which current applications did the live emergency lane miss
-- before the history load filled them in (rows first seen in the 2026-11-05
-- 04:50 UTC load window), and why (legal_case seed? poll/probe record?).
\echo == live lane span: first and last first_seen_at of rows it created, per docket year
SELECT substring(docket_number FROM 1 FOR 3) AS year, count(*) AS rows, min(first_seen_at), max(first_seen_at),
  min(substring(docket_number FROM 4)::int) AS low_no, max(substring(docket_number FROM 4)::int) AS high_no
FROM scotus_application
WHERE NOT (first_seen_at >= '2026-11-05 04:50:30+00' AND first_seen_at < '2026-11-05 04:51:00+00')
  AND docket_number ~ '^2[56]A[0-9]+$'
GROUP BY 1 ORDER BY 1;

\echo == filled in by the history load: 25A/26A, by year, status and kind
SELECT substring(docket_number FROM 1 FOR 3) AS year, status, kind <> 'extension' AS serious, source_lane, count(*)
FROM scotus_application
WHERE first_seen_at >= '2026-11-05 04:50:30+00' AND first_seen_at < '2026-11-05 04:51:00+00'
  AND docket_number ~ '^2[56]A[0-9]+$'
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;

\echo == each 26A row the load filled in, plus pending 25A: dates, legal_case presence, number neighbours
SELECT a.docket_number, a.kind, a.status, a.source_lane, a.docketed_on, a.submitted_on, a.last_entry_on,
  EXISTS (SELECT 1 FROM legal_case lc JOIN court c ON c.id = lc.court_id AND lower(c.provider_court_id) = 'scotus'
          WHERE lc.docket_number = a.docket_number) AS in_legal_case,
  (SELECT max(b.first_seen_at) FROM scotus_application b
    WHERE b.docket_number ~ '^26A[0-9]+$' AND substring(b.docket_number FROM 4)::int > substring(a.docket_number FROM 4)::int
      AND substring(b.docket_number FROM 4)::int <= substring(a.docket_number FROM 4)::int + 3
      AND NOT (b.first_seen_at >= '2026-11-05 04:50:30+00' AND b.first_seen_at < '2026-11-05 04:51:00+00')) AS next_live_seen
FROM scotus_application a
WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
  AND (a.docket_number ~ '^26A[0-9]+$' OR (a.docket_number ~ '^25A[0-9]+$' AND a.status = 'pending'))
ORDER BY substring(a.docket_number FROM 1 FOR 2), substring(a.docket_number FROM 4)::int;

\echo == frontier probe misses are never recorded; poll rows the live lane wrote for 26A with 404
SELECT count(*) FILTER (WHERE last_status = 404) AS not_found, count(*) AS rows FROM scotus_source_poll WHERE docket_number ~ '^26A[0-9]+$';
