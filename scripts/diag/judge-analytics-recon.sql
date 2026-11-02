-- Read-only recon for lower-court judge analytics (case-depth F4).
\echo '== judges, FJC id, verification'
SELECT verification::text, (fjc_nid IS NOT NULL) AS has_fjc, judge_type, count(*) FROM judge GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 30;
\echo '== service terms by category / party'
SELECT court_category, appointing_president_party, service_type, count(*), count(DISTINCT judge_id) AS judges, count(commission_date) AS with_commission
FROM judge_service_term GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 60;
\echo '== service term source systems'
SELECT source_system, count(*) FROM judge_service_term GROUP BY 1 ORDER BY 2 DESC;
\echo '== assignments by court category of the case court, role, method'
SELECT CASE WHEN court.provider_court_id ~ '^ca[0-9dcf]+$' THEN 'appeals' WHEN court.provider_court_id ~ 'b$' THEN 'bankr' WHEN court.provider_court_id='scotus' THEN 'scotus' ELSE coalesce(court.jurisdiction,'?') END, a.assignment_role, a.extraction_method, count(*), count(DISTINCT a.judge_id) AS judges, count(DISTINCT a.case_id) AS cases
FROM judge_case_assignment a JOIN legal_case lc ON lc.id = a.case_id JOIN court ON court.id = lc.court_id
GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 40;
\echo '== courts by jurisdiction'
SELECT jurisdiction, count(*) FROM court GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
\echo '== match candidates by status'
SELECT status, matcher_version, count(*) FROM judge_match_candidate GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;
\echo '== profile fact types'
SELECT fact_type, source_system, count(*) FROM judge_profile_fact GROUP BY 1,2 ORDER BY 3 DESC LIMIT 30;
\echo '== observations'
SELECT observation_type, favored_side, disposition, count(*) FROM judge_case_observation GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 30;
\echo '== cases by court type with judgment/disposition'
SELECT CASE WHEN court.provider_court_id ~ '^ca[0-9dcf]+$' THEN 'appeals' WHEN court.provider_court_id ~ 'b$' THEN 'bankr' WHEN court.provider_court_id='scotus' THEN 'scotus' ELSE coalesce(court.jurisdiction,'?') END, lc.judgment_state, lc.disposition_scope, lc.appeal_state, count(*)
FROM legal_case lc JOIN court ON court.id = lc.court_id WHERE lc.publication='published'
GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 40;
\echo '== tables mentioning appeal/origin/related/panel'
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'
 AND (column_name ~ '(appeal|origin|related|panel|lower_court|reverse|affirm)' OR table_name ~ '(appeal|relation|link|panel)') ORDER BY 1,2 LIMIT 80;
\echo '== appellate ingestion items by state'
SELECT state, count(*), count(published_case_id) FROM appellate_ingestion_item GROUP BY 1 ORDER BY 2 DESC;
\echo '== sample appellate published opinion docket entries / documents'
SELECT lc.public_id, court.name, lc.docket_number, lc.judgment_state, lc.disposition_scope, lc.decided_on, left(lc.status_explanation,160)
FROM appellate_ingestion_item i JOIN legal_case lc ON lc.id=i.published_case_id JOIN court ON court.id=lc.court_id
ORDER BY i.decided_on DESC NULLS LAST LIMIT 8;
