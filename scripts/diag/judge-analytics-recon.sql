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
\echo '== opinion clusters: panel names and metadata keys (by court kind)'
SELECT CASE WHEN court.provider_court_id ~ '^ca[0-9dcf]+$' THEN 'appeals' WHEN court.provider_court_id = 'scotus' THEN 'scotus' ELSE coalesce(court.jurisdiction,'?') END AS kind,
  count(*) AS clusters, count(*) FILTER (WHERE nullif(btrim(oc.judges),'') IS NOT NULL) AS with_judges,
  count(*) FILTER (WHERE nullif(btrim(oc.procedural_history),'') IS NOT NULL) AS with_history
FROM opinion_cluster oc JOIN legal_case lc ON lc.id = oc.case_id JOIN court ON court.id = lc.court_id GROUP BY 1 ORDER BY 2 DESC;
\echo '== cluster provider_metadata keys'
SELECT k, count(*) FROM (SELECT jsonb_object_keys(provider_metadata) k FROM opinion_cluster TABLESAMPLE SYSTEM (5) WHERE jsonb_typeof(provider_metadata)='object' LIMIT 50000) x GROUP BY 1 ORDER BY 2 DESC LIMIT 60;
\echo '== opinion provider_metadata keys'
SELECT k, count(*) FROM (SELECT jsonb_object_keys(provider_metadata) k FROM judicial_opinion TABLESAMPLE SYSTEM (5) WHERE jsonb_typeof(provider_metadata)='object' LIMIT 50000) x GROUP BY 1 ORDER BY 2 DESC LIMIT 60;
\echo '== sample appeals clusters'
SELECT court.provider_court_id, oc.date_filed, left(oc.judges,120) AS judges, left(oc.provider_metadata::text,400) AS meta
FROM opinion_cluster oc JOIN legal_case lc ON lc.id = oc.case_id JOIN court ON court.id = lc.court_id
WHERE court.provider_court_id ~ '^ca[0-9dcf]+$' ORDER BY oc.date_filed DESC NULLS LAST LIMIT 8;
\echo '== assignment judges with FJC appointment party by court kind'
SELECT t.court_category, t.appointing_president_party, count(DISTINCT a.judge_id) AS judges, count(DISTINCT a.case_id) AS cases
FROM judge_case_assignment a JOIN judge_service_term t ON t.judge_id = a.judge_id AND t.service_type = 'article_iii_active'
GROUP BY 1,2 ORDER BY 4 DESC LIMIT 30;
\echo '== docket entries mentioning appeal mandate/affirmed/reversed (1% block sample, to keep load low)'
SELECT count(*) FILTER (WHERE description ~* 'mandate') AS mandate, count(*) FILTER (WHERE description ~* '\maffirm') AS affirmed,
  count(*) FILTER (WHERE description ~* '\mrevers') AS reversed, count(*) FILTER (WHERE description ~* 'notice of appeal') AS notice_of_appeal
FROM docket_entry TABLESAMPLE SYSTEM (1);
