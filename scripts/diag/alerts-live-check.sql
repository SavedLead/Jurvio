-- Read-only: is the 10-minute account-alerts job running, and did public
-- events arrive after the QA follows were created?
\echo == account-alerts runs (last 2 hours)
SELECT started_at, duration_ms, exit_code, ok, left(error_tail, 400) AS error_tail
FROM scheduler_lane_run WHERE lane = 'account-alerts' AND started_at > now() - interval '2 hours'
ORDER BY started_at DESC LIMIT 15;

\echo == QA follows
SELECT f.kind, f.target_key, f.created_at,
  (SELECT count(*) FROM entity_alert_item i WHERE i.follow_id = f.id) AS stored
FROM entity_follow f JOIN app_user u ON u.id = f.user_id WHERE u.email = 'alerts-qa@example.com';

\echo == docket entries created since the follows, on published cases, by caption/topic hint
SELECT
  count(*) AS entries_on_published,
  count(*) FILTER (WHERE c.caption ~* '\mblanche\M') AS blanche,
  count(*) FILTER (WHERE c.nature_of_suit_code ~ '^\s*[0-9]?46[0-5]') AS immigration_nos,
  count(*) FILTER (WHERE c.nature_of_suit_code ~ '^\s*[0-9]?44[0-8]') AS civil_rights_nos,
  count(*) FILTER (WHERE e.filed_on >= current_date - 14) AS filed_recent,
  min(e.created_at) AS first_created, max(e.created_at) AS last_created
FROM docket_entry e JOIN legal_case c ON c.id = e.case_id
WHERE e.created_at > (SELECT min(f.created_at) FROM entity_follow f JOIN app_user u ON u.id = f.user_id WHERE u.email = 'alerts-qa@example.com')
  AND c.publication = 'published';

\echo == all docket entries created in the last 3 hours, by hour
SELECT date_trunc('hour', e.created_at) AS hour, count(*) AS entries,
  count(*) FILTER (WHERE c.publication = 'published') AS on_published
FROM docket_entry e JOIN legal_case c ON c.id = e.case_id
WHERE e.created_at > now() - interval '3 hours' GROUP BY 1 ORDER BY 1;

\echo == cursors
SELECT source, scanned_to, now() - scanned_to AS lag FROM entity_alert_cursor ORDER BY source;
