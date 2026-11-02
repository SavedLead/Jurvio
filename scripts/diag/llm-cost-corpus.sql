-- Read-only sizing of published opinion text for an LLM cost estimate.
-- Lengths use octet_length (reads the TOAST header; ~= characters for the
-- mostly-ASCII opinion text). Input cap = first 48,000 chars (~12k tokens),
-- or the syllabus when one is present (>= 200 chars), also capped.
\echo '=== LLM COST CORPUS SIZING (read-only) ==='
SELECT now() AS at_utc;

\echo '=== per court group: grp | cases | total_chars | median_chars | p90_chars | with_syllabus | capped_input_chars | median_capped ==='
WITH pc AS (
  SELECT c.id, c.decided_on,
         CASE WHEN ct.provider_court_id = 'scotus' OR c.supreme_court_term IS NOT NULL THEN 'scotus'
              WHEN ct.jurisdiction IN ('F', 'Federal Appellate') THEN 'appeals'
              WHEN ct.jurisdiction = 'FD' THEN 'district'
              ELSE 'other:' || coalesce(ct.jurisdiction, '?') END AS grp
    FROM legal_case c JOIN court ct ON ct.id = c.court_id
   WHERE c.publication = 'published'),
docs AS (
  SELECT d.case_id, sum(octet_length(dc.content_text))::bigint AS chars,
         bool_or(jo.opinion_type IN ('majority', '010combined', '020lead')) AS has_lead
    FROM document d JOIN document_content dc ON dc.document_id = d.id
    LEFT JOIN judicial_opinion jo ON jo.document_id = d.id
   WHERE d.publication = 'published' AND d.document_type = 'judicial_opinion' AND dc.word_count > 0
   GROUP BY 1),
syl AS (
  SELECT case_id, max(n) AS syl_chars FROM (
    SELECT case_id, length(syllabus) AS n FROM opinion_cluster WHERE coalesce(syllabus, '') <> ''
    UNION ALL
    SELECT case_id, length(syllabus_text) FROM scotus_case_enrichment WHERE coalesce(syllabus_text, '') <> '') s
   GROUP BY 1),
w AS (
  SELECT pc.grp, pc.decided_on, docs.chars, docs.has_lead, syl.syl_chars,
         (sce.decision_lineup IS NOT NULL) AS scdb_merits,
         CASE WHEN coalesce(syl.syl_chars, 0) >= 200 THEN least(syl.syl_chars, 48000) ELSE least(docs.chars, 48000) END AS cap_chars
    FROM pc JOIN docs ON docs.case_id = pc.id
    LEFT JOIN syl ON syl.case_id = pc.id
    LEFT JOIN scotus_case_enrichment sce ON sce.case_id = pc.id),
g AS (
  SELECT grp, chars, cap_chars, syl_chars FROM w
  UNION ALL SELECT 'scotus_merits_scdb', chars, cap_chars, syl_chars FROM w WHERE grp = 'scotus' AND scdb_merits
  UNION ALL SELECT 'scotus_decided_lead', chars, cap_chars, syl_chars FROM w WHERE grp = 'scotus' AND decided_on IS NOT NULL AND has_lead
  UNION ALL SELECT 'scotus_merits_scdb_and_decided', chars, cap_chars, syl_chars FROM w WHERE grp = 'scotus' AND scdb_merits AND decided_on IS NOT NULL
  UNION ALL SELECT 'ALL', chars, cap_chars, syl_chars FROM w)
SELECT grp, count(*) AS cases, sum(chars) AS total_chars,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY chars) AS median_chars,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY chars) AS p90_chars,
       count(*) FILTER (WHERE coalesce(syl_chars, 0) >= 200) AS with_syllabus,
       sum(cap_chars) AS capped_input_chars,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY cap_chars) AS median_capped
  FROM g GROUP BY 1 ORDER BY 1;

\echo '=== published scotus cases overall (with/without text) ==='
SELECT count(*) AS scotus_published, count(*) FILTER (WHERE c.decided_on IS NOT NULL) AS decided,
       count(sce.decision_lineup) AS scdb_matched
  FROM legal_case c JOIN court ct ON ct.id = c.court_id
  LEFT JOIN scotus_case_enrichment sce ON sce.case_id = c.id
 WHERE c.publication = 'published' AND (ct.provider_court_id = 'scotus' OR c.supreme_court_term IS NOT NULL);
