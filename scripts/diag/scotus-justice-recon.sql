-- Read-only recon for the SCDB justice-analytics import: how Supreme Court
-- cases are keyed in production (citation, docket, decision date, term).
\echo '=== SCOTUS court rows ==='
SELECT id, public_id, provider_court_id, name FROM court WHERE lower(provider_court_id) = 'scotus' OR name ILIKE 'Supreme Court of the United States%';

\echo '=== legal_case with supreme_court_term: totals ==='
SELECT count(*) AS cases, count(official_citation) AS with_citation, count(decided_on) AS with_decided_on,
       count(*) FILTER (WHERE official_citation ~ '^[0-9]+ U\.\s?S\. [0-9]+$') AS us_cite_shape,
       min(supreme_court_term) AS min_term, max(supreme_court_term) AS max_term,
       count(*) FILTER (WHERE publication = 'published') AS published
FROM legal_case WHERE supreme_court_term IS NOT NULL;

\echo '=== legal_case in the SCOTUS court without supreme_court_term ==='
SELECT count(*) FROM legal_case lc JOIN court c ON c.id = lc.court_id
WHERE lower(c.provider_court_id) = 'scotus' AND lc.supreme_court_term IS NULL;

\echo '=== cases by decade of term ==='
SELECT (supreme_court_term / 10 * 10) AS decade, count(*), count(official_citation) AS cited
FROM legal_case WHERE supreme_court_term IS NOT NULL GROUP BY 1 ORDER BY 1;

\echo '=== citation shapes (top 15 by regex class) ==='
SELECT regexp_replace(coalesce(official_citation, '<null>'), '[0-9]+', 'N', 'g') AS shape, count(*)
FROM legal_case WHERE supreme_court_term IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

\echo '=== docket_number shapes (top 15) ==='
SELECT regexp_replace(docket_number, '[0-9]+', 'N', 'g') AS shape, count(*)
FROM legal_case WHERE supreme_court_term IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

\echo '=== samples (recent, 1990s, 1950s) ==='
(SELECT supreme_court_term, decided_on, docket_number, official_citation, left(caption, 60) FROM legal_case WHERE supreme_court_term >= 2023 ORDER BY decided_on DESC NULLS LAST LIMIT 8)
UNION ALL
(SELECT supreme_court_term, decided_on, docket_number, official_citation, left(caption, 60) FROM legal_case WHERE supreme_court_term BETWEEN 1990 AND 1991 ORDER BY decided_on LIMIT 5)
UNION ALL
(SELECT supreme_court_term, decided_on, docket_number, official_citation, left(caption, 60) FROM legal_case WHERE supreme_court_term BETWEEN 1950 AND 1951 ORDER BY decided_on LIMIT 5);

\echo '=== duplicate official_citation among SCOTUS rows ==='
SELECT count(*) AS dup_citations, coalesce(sum(n), 0) AS rows_involved FROM (
  SELECT official_citation, count(*) n FROM legal_case WHERE supreme_court_term IS NOT NULL AND official_citation IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;

\echo '=== case_citation_identity keys on SCOTUS rows (by key family) ==='
SELECT regexp_replace(cci.citation_key, '^[0-9]+([a-z.'']+)[0-9]+$', '\1') AS family, count(*), count(DISTINCT cci.case_id) AS cases
FROM case_citation_identity cci JOIN legal_case lc ON lc.id = cci.case_id
WHERE lc.supreme_court_term IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12;

\echo '=== existing judge rows for the Supreme Court (FJC) ==='
SELECT count(DISTINCT j.id) AS judges, count(DISTINCT j.fjc_nid) AS with_fjc_nid
FROM judge j JOIN judge_service_term t ON t.judge_id = j.id WHERE t.court_category = 'scotus';

\echo '=== tables that already look like justice/vote analytics ==='
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND (table_name ILIKE '%justice%' OR table_name ILIKE '%scdb%' OR table_name ILIKE '%vote%' OR table_name ILIKE '%martin%');

\echo '=== decision_lineup keys present ==='
SELECT k, count(*) FROM scotus_case_enrichment e, jsonb_object_keys(e.decision_lineup) k GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
