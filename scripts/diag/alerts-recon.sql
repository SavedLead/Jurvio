-- Recon for judge/topic/party alerts (read-only). Sizes, indexes, recent
-- ingest volume by court type, NOS coverage, judge/party link coverage.
\timing on
SELECT relname, reltuples::bigint AS est_rows, pg_size_pretty(pg_total_relation_size(oid)) AS size
FROM pg_class WHERE relname IN ('legal_case','docket_entry','document','party_appearance','entity','judge','judge_case_assignment','appeals_panel_seat','district_opinion_judge','publication_current','publication_decision','direct_court_event','case_follow','app_user')
ORDER BY relname;

SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE tablename IN ('legal_case','docket_entry','document','party_appearance','entity','judge_case_assignment')
ORDER BY tablename, indexname;

-- Court type helper: scotus / appeals / district / other
SELECT CASE WHEN lower(court.provider_court_id)='scotus' THEN 'scotus'
            WHEN court.provider_court_id ~ '^ca([0-9]+|dc|fed|fc)$' OR court.jurisdiction ILIKE '%appell%' THEN 'appeals'
            WHEN court.jurisdiction ILIKE '%district%' OR court.provider_court_id ~ 'd$' THEN 'district'
            ELSE 'other' END AS kind,
  count(*) AS courts
FROM court GROUP BY 1 ORDER BY 1;

-- Users / follows
SELECT (SELECT count(*) FROM app_user) users, (SELECT count(*) FROM app_user WHERE email_verified_at IS NOT NULL) verified,
  (SELECT count(*) FROM case_follow) follows, (SELECT count(*) FROM account_subscription) subs;
SELECT kind, status, count(*), max(created_at) FROM email_event GROUP BY 1,2 ORDER BY 1,2;

-- Recent published cases (last 7 days by created_at) via the draft/published index paths
SELECT CASE WHEN lower(court.provider_court_id)='scotus' THEN 'scotus'
            WHEN court.provider_court_id ~ '^ca([0-9]+|dc|fed|fc)$' THEN 'appeals' ELSE 'district/other' END AS kind,
  legal_case.publication, count(*) AS n, count(legal_case.nature_of_suit_code) AS with_nos
FROM legal_case JOIN court ON court.id = legal_case.court_id
WHERE legal_case.created_at > now() - interval '7 days'
GROUP BY 1,2 ORDER BY 1,2;

-- Published cases whose publication changed recently (updated_at index)
SELECT date_trunc('day', updated_at) d, count(*) FROM legal_case
WHERE publication='published' AND updated_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1;

-- NOS codes among published cases (top 60)
SELECT nature_of_suit_code, count(*) n FROM legal_case WHERE publication='published' AND nature_of_suit_code IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 60;
SELECT count(*) FILTER (WHERE nature_of_suit_code IS NOT NULL) with_nos, count(*) total FROM legal_case WHERE publication='published';

-- New docket entries, last 3 days, by court type and displayability
SELECT CASE WHEN lower(court.provider_court_id)='scotus' THEN 'scotus'
            WHEN court.provider_court_id ~ '^ca([0-9]+|dc|fed|fc)$' THEN 'appeals' ELSE 'district/other' END AS kind,
  legal_case.publication,
  COALESCE(pc.displayable, false) AS entry_displayable,
  count(*) n, count(DISTINCT e.case_id) cases, min(e.created_at) first_at, max(e.created_at) last_at
FROM docket_entry e
JOIN legal_case ON legal_case.id = e.case_id
JOIN court ON court.id = legal_case.court_id
LEFT JOIN publication_current pc ON pc.object_type='docket_entry' AND pc.object_id = e.id
WHERE e.created_at > now() - interval '3 days'
GROUP BY 1,2,3 ORDER BY 1,2,3;

-- entry_type / importance values on recent entries
SELECT entry_type, importance, count(*) FROM docket_entry WHERE created_at > now() - interval '3 days' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 40;

-- Recent documents (opinions) by type and displayability
SELECT CASE WHEN lower(court.provider_court_id)='scotus' THEN 'scotus'
            WHEN court.provider_court_id ~ '^ca([0-9]+|dc|fed|fc)$' THEN 'appeals' ELSE 'district/other' END AS kind,
  d.document_type, d.publication, COALESCE(pc.displayable,false) disp, count(*)
FROM document d JOIN legal_case ON legal_case.id = d.case_id JOIN court ON court.id = legal_case.court_id
LEFT JOIN publication_current pc ON pc.object_type='document' AND pc.object_id = d.id
WHERE d.created_at > now() - interval '7 days'
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;

-- Judge links
SELECT count(*) assignments, count(DISTINCT judge_id) judges, count(DISTINCT case_id) cases, max(created_at) latest FROM judge_case_assignment;
SELECT extraction_method, assignment_role, count(*) FROM judge_case_assignment GROUP BY 1,2;
SELECT count(*) seats, count(DISTINCT judge_id) judges, max(decided_on) latest_decided FROM appeals_panel_seat WHERE judge_id IS NOT NULL;
SELECT count(*) FROM judge WHERE verification='verified';
-- assignments on cases created recently
SELECT count(*) FROM judge_case_assignment a JOIN legal_case c ON c.id=a.case_id WHERE c.created_at > now() - interval '7 days';

-- Party appearances on recent cases
SELECT count(*) appearances, count(DISTINCT pa.entity_id) entities FROM party_appearance pa JOIN legal_case c ON c.id=pa.case_id
WHERE c.created_at > now() - interval '7 days';
SELECT e.entity_type, count(*) FROM entity e GROUP BY 1;
-- sample normalized names (top parties among published cases)
SELECT e.normalized_name, e.display_name, count(*) n FROM party_appearance pa JOIN entity e ON e.id=pa.entity_id
JOIN legal_case c ON c.id=pa.case_id WHERE c.publication='published' AND c.created_at > now() - interval '30 days'
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25;

-- Restricted signals
SELECT count(*) FILTER (WHERE restricted) restricted, count(*) total FROM direct_court_event WHERE first_seen_at > now() - interval '7 days';
SELECT reason_code, displayable, count(*) FROM publication_decision WHERE object_type='docket_entry' AND decided_at > now() - interval '7 days' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;
SELECT event_type, restricted, publication_state, count(*) FROM direct_court_event WHERE first_seen_at > now() - interval '7 days' GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 30;
SELECT count(*) FROM public_case_search;
