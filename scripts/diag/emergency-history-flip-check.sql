-- Read-only: did the live emergency lane's re-reads of history rows (after
-- backfill 41970173942 loaded them at 2026-11-05 04:50:40-04:50:48 UTC) cause
-- any alert items or emails, and is it still re-fetching them?
\echo == history-load rows now live (would be reverted), by docket year
SELECT substring(a.docket_number FROM 1 FOR 3) AS year, count(*) AS rows, count(*) FILTER (WHERE a.withheld_lines > 0) AS with_withheld
FROM scotus_application a
WHERE a.source_lane = 'live' AND a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
GROUP BY 1 ORDER BY 1;

\echo == history-load rows re-checked by the live lane after the load (poll rows), by hour
SELECT date_trunc('hour', p.checked_at) AS hour, count(*) AS rechecked, count(*) FILTER (WHERE a.source_lane = 'live') AS now_live
FROM scotus_source_poll p JOIN scotus_application a ON a.docket_number = p.docket_number
WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
  AND p.checked_at > '2026-11-05 04:52:00+00'
GROUP BY 1 ORDER BY 1;

\echo == new (non-backfilled) docket lines the live lane recorded on history-load rows
SELECT count(*) AS lines, count(DISTINCT e.docket_number) AS dockets, min(e.detected_at), max(e.detected_at)
FROM scotus_application_event e JOIN scotus_application a ON a.docket_number = e.docket_number
WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
  AND NOT e.backfilled AND e.detected_at > '2026-11-05 04:52:00+00';

\echo == docket_entry rows created on those rows' cases since the load
SELECT count(*) AS entries, count(DISTINCT de.case_id) AS cases, min(de.created_at), max(de.created_at)
FROM docket_entry de JOIN scotus_application a ON a.case_id = de.case_id
WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
  AND de.created_at > '2026-11-05 04:52:00+00';

\echo == case follows and entity alert items touching those rows' cases
SELECT (SELECT count(*) FROM case_follow cf JOIN scotus_application a ON a.case_id = cf.case_id
          WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00') AS case_follows,
       (SELECT count(*) FROM entity_alert_item i JOIN scotus_application a ON a.case_id = i.case_id
          WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
            AND i.found_at > '2026-11-05 04:52:00+00') AS alert_items_found,
       (SELECT count(*) FROM entity_alert_item i JOIN scotus_application a ON a.case_id = i.case_id
          WHERE a.first_seen_at >= '2026-11-05 04:50:30+00' AND a.first_seen_at < '2026-11-05 04:51:00+00'
            AND i.sent_at IS NOT NULL AND i.found_at > '2026-11-05 04:52:00+00') AS alert_items_sent;

\echo == alert digest emails by hour, Nov 4 12:00 UTC onward (before and after the load)
SELECT date_trunc('hour', created_at) AS hour, kind, status, count(*)
FROM email_event WHERE created_at > '2026-11-04 12:00:00+00' AND kind = 'alert_digest'
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo == entity alert items found by hour (all follows), Nov 4 12:00 UTC onward
SELECT date_trunc('hour', found_at) AS hour, count(*) AS found, count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent
FROM entity_alert_item WHERE found_at > '2026-11-04 12:00:00+00' GROUP BY 1 ORDER BY 1;
