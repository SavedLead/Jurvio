-- Read-only: SCOTUS emergency + other SCOTUS lanes + follows + plain-English signal coverage.
-- One-shot freshness check for product lock-in (2026-11-05).

\echo == now (UTC + ET)
SELECT now() AS utc_now, timezone('America/New_York', now()) AS et_now;

\echo == A1 scotus-emergency / scotus-live-dockets / scotus-enriched / scotus-publish lane runs (48h)
SELECT lane, count(*) AS runs,
  count(*) FILTER (WHERE ok) AS ok_runs,
  count(*) FILTER (WHERE NOT ok) AS fail_runs,
  round(avg(duration_ms) / 1000.0, 1) AS avg_s,
  max(started_at) AS last_start_utc,
  timezone('America/New_York', max(started_at)) AS last_start_et,
  max(finished_at) FILTER (WHERE ok) AS last_ok_finish_utc,
  timezone('America/New_York', max(finished_at) FILTER (WHERE ok)) AS last_ok_finish_et
FROM scheduler_lane_run
WHERE lane IN (
  'scotus-emergency','scotus-live-dockets','scotus-enriched','scotus-publish',
  'direct-court','coa-live-feeds','appellate-official','appellate-pacer-rss',
  'account-alerts','courtlistener-court-feeds','govinfo-daily','live-opinion-text'
) AND started_at > now() - interval '48 hours'
GROUP BY lane ORDER BY lane;

\echo == A2 emergency poll freshness (host + sample)
SELECT
  count(*) AS poll_rows,
  count(*) FILTER (WHERE docket_number ~ '^26A') AS polls_26a,
  max(checked_at) AS last_checked_utc,
  timezone('America/New_York', max(checked_at)) AS last_checked_et,
  max(changed_at) AS last_changed_utc,
  timezone('America/New_York', max(changed_at)) AS last_changed_et,
  count(*) FILTER (WHERE checked_at > now() - interval '15 minutes') AS checked_last_15m,
  count(*) FILTER (WHERE changed_at > now() - interval '24 hours') AS changed_last_24h,
  count(*) FILTER (WHERE last_status = 200) AS status_200,
  count(*) FILTER (WHERE last_status = 304) AS status_304,
  count(*) FILTER (WHERE last_status = 404) AS status_404,
  count(*) FILTER (WHERE last_status = 429) AS status_429
FROM scotus_source_poll;

\echo == A3 highest 26A / 25A in scotus_application and legal_case
SELECT 'scotus_application' AS src,
  max(substring(docket_number from 4)::int) FILTER (WHERE docket_number ~ '^26A[0-9]+$') AS max_26a,
  max(substring(docket_number from 4)::int) FILTER (WHERE docket_number ~ '^25A[0-9]+$') AS max_25a,
  count(*) FILTER (WHERE docket_number ~ '^26A') AS n_26a,
  count(*) FILTER (WHERE docket_number ~ '^25A') AS n_25a,
  count(*) FILTER (WHERE status = 'pending' AND kind <> 'extension') AS pending_serious,
  count(*) FILTER (WHERE status = 'pending') AS pending_all
FROM scotus_application
UNION ALL
SELECT 'legal_case',
  max(nullif(regexp_replace(c.docket_number, '^[0-9]{2}A', ''), '')::int) FILTER (WHERE c.docket_number ~ '^26A[0-9]+$'),
  max(nullif(regexp_replace(c.docket_number, '^[0-9]{2}A', ''), '')::int) FILTER (WHERE c.docket_number ~ '^25A[0-9]+$'),
  count(*) FILTER (WHERE c.docket_number ~ '^26A'),
  count(*) FILTER (WHERE c.docket_number ~ '^25A'),
  NULL, NULL
FROM legal_case c
JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^[0-9]{2}A[0-9]+$';

\echo == A4 top 26A applications (highest numbers)
SELECT docket_number, status, kind, poll_tier, docketed_on, last_entry_on,
  timezone('America/New_York', first_seen_at) AS first_seen_et,
  timezone('America/New_York', changed_at) AS changed_et,
  timezone('America/New_York', updated_at) AS updated_et,
  entry_count, withheld_lines, source_lane
FROM scotus_application
WHERE docket_number ~ '^26A[0-9]+$'
ORDER BY substring(docket_number from 4)::int DESC
LIMIT 12;

\echo == A5 docket-line flow: newest emergency events (non-backfilled first)
SELECT count(*) AS events_total,
  count(*) FILTER (WHERE NOT backfilled) AS live_detected,
  count(*) FILTER (WHERE detected_at > now() - interval '24 hours') AS detected_24h,
  count(*) FILTER (WHERE detected_at > now() - interval '6 hours' AND NOT backfilled) AS live_detected_6h,
  max(detected_at) AS newest_detected_utc,
  timezone('America/New_York', max(detected_at)) AS newest_detected_et,
  max(detected_at) FILTER (WHERE NOT backfilled) AS newest_live_utc,
  timezone('America/New_York', max(detected_at) FILTER (WHERE NOT backfilled)) AS newest_live_et
FROM scotus_application_event;

\echo == A5b newest live (non-backfilled) events detail
SELECT e.docket_number, e.kind, e.filed_on, e.backfilled,
  timezone('America/New_York', e.detected_at) AS detected_et,
  left(e.description, 120) AS description
FROM scotus_application_event e
WHERE NOT e.backfilled
ORDER BY e.detected_at DESC
LIMIT 15;

\echo == B1 SCOTUS paid/IFP docket watermarks + court freshness
SELECT source, court_code, cursor_value,
  timezone('America/New_York', last_success_at) AS last_success_et,
  timezone('America/New_York', last_attempt_at) AS last_attempt_et,
  consecutive_failures
FROM court_source_watermark
WHERE court_code = 'scotus' OR source LIKE 'scotus%'
ORDER BY source, court_code;

\echo == B2 SCOTUS case / opinion / enrichment ingest freshness
SELECT 'legal_case_scotus' AS kind, count(*) AS n,
  timezone('America/New_York', max(created_at)) AS newest_created_et,
  timezone('America/New_York', max(updated_at)) AS newest_updated_et
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
UNION ALL
SELECT 'legal_case_26_paid', count(*),
  timezone('America/New_York', max(c.created_at)), timezone('America/New_York', max(c.updated_at))
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^26-[0-9]+$' AND c.docket_number !~ '^26-5'
UNION ALL
SELECT 'legal_case_26_ifp', count(*),
  timezone('America/New_York', max(c.created_at)), timezone('America/New_York', max(c.updated_at))
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^26-5[0-9]+$'
UNION ALL
SELECT 'legal_case_25_any', count(*),
  timezone('America/New_York', max(c.created_at)), timezone('America/New_York', max(c.updated_at))
FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^25-'
UNION ALL
SELECT 'scotus_case_enrichment', count(*),
  timezone('America/New_York', max(created_at)), timezone('America/New_York', max(updated_at))
FROM scotus_case_enrichment
UNION ALL
SELECT 'official_opinion_candidate', count(*),
  timezone('America/New_York', max(created_at)), timezone('America/New_York', max(updated_at))
FROM official_opinion_candidate
UNION ALL
SELECT 'docket_entry_scotus', count(*),
  timezone('America/New_York', max(e.created_at)), timezone('America/New_York', max(e.created_at))
FROM docket_entry e
JOIN legal_case c ON c.id = e.case_id
JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus';

\echo == B3 highest 26- paid / IFP dockets held
SELECT
  max(nullif(regexp_replace(c.docket_number, '^26-', ''), '')::int)
    FILTER (WHERE c.docket_number ~ '^26-[0-9]+$' AND nullif(regexp_replace(c.docket_number, '^26-', ''), '')::int < 5000) AS max_26_paid,
  max(nullif(regexp_replace(c.docket_number, '^26-', ''), '')::int)
    FILTER (WHERE c.docket_number ~ '^26-5[0-9]+$') AS max_26_ifp
FROM legal_case c
JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
WHERE c.docket_number ~ '^26-';

\echo == B4 scotus_docket_status / question_presented / justice notes coverage
SELECT 'scotus_docket_status' AS t, count(*) AS n,
  count(*) FILTER (WHERE cert_status = 'granted') AS granted,
  count(*) FILTER (WHERE cert_status = 'denied') AS denied,
  timezone('America/New_York', max(updated_at)) AS newest_et
FROM scotus_docket_status
UNION ALL
SELECT 'scotus_question_presented', count(*), NULL, NULL,
  timezone('America/New_York', max(updated_at))
FROM scotus_question_presented
UNION ALL
SELECT 'scotus_docket_justice_note', count(*), NULL, NULL,
  timezone('America/New_York', max(created_at))
FROM scotus_docket_justice_note;

\echo == C1 followed-case feeds freshness (follows + alerts + lower-court lanes)
SELECT lane, count(*) AS runs_48h, count(*) FILTER (WHERE ok) AS ok,
  timezone('America/New_York', max(started_at)) AS last_start_et,
  timezone('America/New_York', max(finished_at) FILTER (WHERE ok)) AS last_ok_et
FROM scheduler_lane_run
WHERE lane IN ('account-alerts','direct-court','coa-live-feeds','appellate-official','appellate-pacer-rss','courtlistener-court-feeds','case-news','federal-new-cases','federal-material-decisions')
  AND started_at > now() - interval '48 hours'
GROUP BY lane ORDER BY lane;

\echo == C2 follow counts + newest followed-case docket entry ingested
SELECT
  (SELECT count(*) FROM case_follow) AS case_follows,
  (SELECT count(DISTINCT user_id) FROM case_follow) AS users_following,
  (SELECT count(*) FROM case_follow f JOIN legal_case c ON c.id = f.case_id JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id)='scotus') AS scotus_case_follows,
  (SELECT count(*) FROM case_follow f JOIN legal_case c ON c.id = f.case_id WHERE c.docket_number ~ '^[0-9]{2}A') AS a_docket_case_follows,
  (SELECT count(*) FROM entity_follow WHERE kind = 'emergency') AS emergency_feed_follows,
  (SELECT count(*) FROM entity_follow) AS entity_follows;

\echo == C3 newest docket_entry on followed cases
SELECT count(*) AS followed_cases_with_entries,
  timezone('America/New_York', max(e.created_at)) AS newest_entry_on_followed_et,
  max(e.filed_on) AS newest_filed_on
FROM docket_entry e
JOIN case_follow f ON f.case_id = e.case_id;

\echo == C4 direct-court / coa watermark freshness (summary)
SELECT source,
  count(*) AS courts,
  count(*) FILTER (WHERE last_success_at > now() - interval '2 hours') AS ok_2h,
  count(*) FILTER (WHERE last_success_at > now() - interval '24 hours') AS ok_24h,
  timezone('America/New_York', max(last_success_at)) AS newest_success_et,
  max(consecutive_failures) AS max_fails
FROM court_source_watermark
WHERE source IN ('district_rss','coa_feed','appellate_rss','courtlistener_feed','govinfo','scotus_official')
GROUP BY source ORDER BY source;

\echo == D1 plain-English / structured signals on SCOTUS (counts only)
SELECT
  (SELECT count(*) FROM legal_case c JOIN court ct ON ct.id=c.court_id AND lower(ct.provider_court_id)='scotus' WHERE c.publication='published') AS scotus_published,
  (SELECT count(*) FROM scotus_application) AS emergency_apps,
  (SELECT count(*) FROM scotus_application WHERE kind <> 'extension') AS emergency_serious,
  (SELECT count(*) FROM scotus_application_event WHERE plain_line IS NOT NULL AND length(plain_line) > 0) AS emergency_events_with_plain,
  (SELECT count(*) FROM scotus_application_event WHERE plain_line IS NULL OR length(plain_line)=0) AS emergency_events_blank_plain,
  (SELECT count(*) FROM scotus_docket_status) AS with_docket_status,
  (SELECT count(*) FROM scotus_question_presented) AS with_qp,
  (SELECT count(*) FROM scotus_case_enrichment WHERE exact_disposition IS NOT NULL) AS enrichment_with_disposition,
  (SELECT count(*) FROM scotus_case_enrichment) AS enrichment_rows;

\echo == D2 SCOTUS published cases missing key plain-English inputs
SELECT
  count(*) AS published,
  count(s.case_id) AS have_docket_status,
  count(*) - count(s.case_id) AS missing_docket_status,
  count(q.case_id) AS have_qp,
  count(e.case_id) AS have_enrichment,
  count(e.case_id) FILTER (WHERE e.exact_disposition IS NOT NULL) AS have_exact_disposition
FROM legal_case c
JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
LEFT JOIN scotus_docket_status s ON s.case_id = c.id
LEFT JOIN scotus_question_presented q ON q.case_id = c.id
LEFT JOIN scotus_case_enrichment e ON e.case_id = c.id
WHERE c.publication = 'published';
