-- Read-only recon for district-judge analytics (case-depth F4, part 2). Aggregates and short public samples only.
\set ON_ERROR_STOP 1
SET statement_timeout = '120s';
\echo '== district courts: cases, filed/decided fill'
SELECT court.jurisdiction, count(*) AS cases, count(lc.filed_on) AS with_filed, count(lc.decided_on) AS with_decided
FROM legal_case lc JOIN court ON court.id = lc.court_id
WHERE lc.publication = 'published' AND court.jurisdiction IN ('FD', 'Federal District', 'F', 'FS')
GROUP BY 1 ORDER BY 2 DESC;
\echo '== district clusters with a judges line / opinions with an author name'
SELECT court.jurisdiction, count(DISTINCT oc.id) AS clusters, count(DISTINCT oc.id) FILTER (WHERE coalesce(btrim(oc.judges), '') <> '') AS with_judges,
  count(DISTINCT oc.case_id) FILTER (WHERE coalesce(btrim(oc.judges), '') <> '') AS cases_with_judges
FROM opinion_cluster oc JOIN legal_case lc ON lc.id = oc.case_id JOIN court ON court.id = lc.court_id
WHERE court.jurisdiction IN ('FD', 'Federal District', 'F', 'FS') GROUP BY 1 ORDER BY 2 DESC;
SELECT court.jurisdiction, count(*) AS opinions, count(*) FILTER (WHERE coalesce(btrim(jo.author_name), '') <> '') AS with_author
FROM judicial_opinion jo JOIN opinion_cluster oc ON oc.id = jo.cluster_id JOIN legal_case lc ON lc.id = oc.case_id JOIN court ON court.id = lc.court_id
WHERE court.jurisdiction IN ('FD', 'Federal District', 'F', 'FS') GROUP BY 1 ORDER BY 2 DESC;
\echo '== sample district judges lines'
SELECT court.provider_court_id, left(oc.judges, 80) AS judges FROM opinion_cluster oc JOIN legal_case lc ON lc.id = oc.case_id JOIN court ON court.id = lc.court_id
WHERE court.jurisdiction IN ('FD', 'Federal District') AND coalesce(btrim(oc.judges), '') <> '' AND lc.publication = 'published' LIMIT 12;
\echo '== docket entries naming an assigned judge (1% sample of district entries)'
SELECT count(*) AS sampled,
  count(*) FILTER (WHERE d.description ~* '(assigned to|reassigned to|case assigned to)\s+(the\s+)?(honorable\s+|hon\.\s+)?(chief\s+)?(u\.s\.\s+|united states\s+)?(senior\s+)?(district\s+)?judge') AS assigned_lines,
  count(DISTINCT d.case_id) AS cases_sampled,
  count(DISTINCT d.case_id) FILTER (WHERE d.description ~* '(assigned to|reassigned to)\s+(the\s+)?(honorable\s+|hon\.\s+)?(chief\s+)?(u\.s\.\s+|united states\s+)?(senior\s+)?(district\s+)?judge') AS cases_with_assigned
FROM docket_entry d TABLESAMPLE SYSTEM (1) JOIN legal_case lc ON lc.id = d.case_id JOIN court ON court.id = lc.court_id
WHERE court.jurisdiction IN ('FD', 'Federal District') AND lc.publication = 'published';
\echo '== sample assigned-judge phrases (public, unsealed)'
SELECT substring(d.description from '(?i)((re)?assigned to\s+[^.;]{0,60})') AS phrase
FROM docket_entry d TABLESAMPLE SYSTEM (1) JOIN legal_case lc ON lc.id = d.case_id JOIN court ON court.id = lc.court_id
WHERE court.jurisdiction IN ('FD', 'Federal District') AND lc.publication = 'published'
  AND d.description ~* '(re)?assigned to\s+(the\s+)?(honorable\s+|hon\.\s+)?(chief\s+)?(district\s+)?judge' AND d.description !~* '(seal|ex parte|restricted)'
LIMIT 12;
\echo '== provider metadata keys on district cases (raw docket fields such as assigned_to)'
SELECT k, count(*) FROM (
  SELECT jsonb_object_keys(ra.response_metadata) AS k FROM raw_artifact ra TABLESAMPLE SYSTEM (0.5) WHERE jsonb_typeof(ra.response_metadata) = 'object'
) keys GROUP BY 1 ORDER BY 2 DESC LIMIT 40;
\echo '== FJC IDB outcomes (filing/termination dates for time to disposition)'
SELECT count(*) AS rows, count(date_terminated) AS with_terminated, min(snapshot_date)::text, max(snapshot_date)::text FROM fjc_idb_case_outcome;
SELECT count(*) AS idb_with_case_filed FROM fjc_idb_case_outcome i JOIN legal_case lc ON lc.id = i.case_id WHERE lc.filed_on IS NOT NULL AND i.date_terminated IS NOT NULL;
