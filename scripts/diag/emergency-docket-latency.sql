-- Read-only: how fast Supreme Court emergency applications (A-dockets) reach Jurvio,
-- how fresh known applications are, and who follows them. Report only; for the
-- emergency-docket alerts plan (Nov 3, 2026).
\echo == A-dockets held, by docket year and publication state
SELECT substr(c.docket_number, 1, 2) AS yy, c.publication::text AS state, count(*) AS cases,
  max(nullif(regexp_replace(c.docket_number, '^[0-9]{2}A', ''), '')::int) AS highest_number
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^[0-9]{2}A[0-9]+$' AND substr(c.docket_number, 1, 2) IN ('24','25','26')
GROUP BY 1, 2 ORDER BY 1, 2;

\echo == 26A discovery lag: hours from docketed date (midnight ET) to the case row appearing in Jurvio
SELECT count(*) AS cases,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM c.created_at - (c.filed_on::timestamp AT TIME ZONE 'America/New_York')) / 3600) AS p50_hours,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM c.created_at - (c.filed_on::timestamp AT TIME ZONE 'America/New_York')) / 3600) AS p90_hours
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^26A[0-9]+$' AND c.filed_on IS NOT NULL AND c.created_at > c.filed_on::timestamp AT TIME ZONE 'America/New_York'
  AND c.created_at > '2026-10-01';

\echo == later entries on 26A dockets (filed after the docketed date): hours from entry date (midnight ET) to stored
SELECT count(*) AS entries,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.created_at - (e.filed_on::timestamp AT TIME ZONE 'America/New_York')) / 3600) AS p50_hours,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM e.created_at - (e.filed_on::timestamp AT TIME ZONE 'America/New_York')) / 3600) AS p90_hours,
  max(e.created_at) AS newest_stored
FROM docket_entry e JOIN legal_case c ON c.id = e.case_id
JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^26A[0-9]+$' AND e.filed_on > c.filed_on AND e.created_at > '2026-10-01'
  AND e.created_at > e.filed_on::timestamp AT TIME ZONE 'America/New_York';

\echo == age of the last official docket refresh for 26A dockets (scotus_case_enrichment.updated_at)
SELECT count(*) AS cases, count(s.case_id) AS refreshed_ever,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - s.updated_at) / 3600) AS p50_age_hours,
  max(extract(epoch FROM now() - s.updated_at) / 3600) AS max_age_hours
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
LEFT JOIN scotus_case_enrichment s ON s.case_id = c.id
WHERE c.docket_number ~ '^26A[0-9]+$';

\echo == SCOTUS lanes, last 24 hours
SELECT lane, count(*) AS runs, count(*) FILTER (WHERE ok) AS ok_runs,
  round(avg(duration_ms) / 1000.0) AS avg_seconds, max(started_at) AS last_start
FROM scheduler_lane_run
WHERE lane IN ('scotus-live-dockets', 'scotus-enriched', 'account-alerts') AND started_at > now() - interval '24 hours'
GROUP BY lane ORDER BY lane;

\echo == accounts and follows (counts only)
SELECT (SELECT count(*) FROM app_user) AS users,
  (SELECT count(DISTINCT user_id) FROM case_follow) AS users_following_cases,
  (SELECT count(*) FROM case_follow) AS case_follows,
  (SELECT count(*) FROM case_follow f JOIN legal_case c ON c.id = f.case_id WHERE c.docket_number ~ '^[0-9]{2}A[0-9]+$') AS a_docket_follows,
  (SELECT count(*) FROM entity_follow) AS entity_follows;
