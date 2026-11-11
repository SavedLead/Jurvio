-- Read-only census of publication = 'draft' on a 1% page sample.
-- TABLESAMPLE SYSTEM (1) keeps about 1% of pages, then the draft filter runs.
-- draft_count_estimate = sample rows * 100. Divide any later count by sample
-- rows for a share, or multiply that share by the estimate for a draft total.
-- If sample rows is only a few hundred, raise SYSTEM (1) to SYSTEM (2) or (5).
--
-- The diagnose checker rejects CREATE, and the session is read only, so the
-- sample cannot be stored in a temp table. Each statement materializes the
-- same REPEATABLE (42) pages once, and child-table probes use only those ids.
-- Each statement stops at 120s. Lock wait stops at 3s.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

WITH draft AS MATERIALIZED (
  SELECT
    length(btrim(coalesce(c.caption, ''))) > 0 AS has_caption,
    length(btrim(coalesce(c.docket_number, ''))) > 0 AS has_docket,
    c.filed_on IS NOT NULL AS has_filed,
    c.terminated_on IS NOT NULL AS has_terminated,
    nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL AS has_nos,
    nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL AS has_cause,
    nullif(btrim(coalesce(c.official_citation, '')), '') IS NOT NULL AS has_citation,
    c.source_artifact_id IS NOT NULL AS has_artifact,
    (concat_ws(' ', c.caption, c.docket_number) ~* '\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M') AS sealed_word,
    CASE
      WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus' THEN 'scotus'
      WHEN lower(coalesce(court.provider_court_id, '')) ~ '^ca([0-9]{1,2}|dc|fc)$' THEN 'appeals'
      WHEN lower(coalesce(court.provider_court_id, '')) ~ '(b|bap[0-9]*)$' THEN 'bankruptcy'
      WHEN lower(coalesce(court.provider_court_id, '')) ~ 'd$' THEN 'district'
      ELSE 'other'
    END AS court_type,
    CASE
      WHEN c.filed_on IS NULL THEN 'no filed date'
      WHEN c.filed_on < DATE '1990-01-01' THEN 'before 1990'
      WHEN c.filed_on < DATE '2000-01-01' THEN '1990-1999'
      WHEN c.filed_on < DATE '2010-01-01' THEN '2000-2009'
      WHEN c.filed_on < DATE '2020-01-01' THEN '2010-2019'
      WHEN c.filed_on < DATE '2027-01-01' THEN '2020-2026'
      ELSE 'after 2026'
    END AS year_bucket
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  JOIN court ON court.id = c.court_id
  WHERE c.publication = 'draft'
)
SELECT section, key, n
FROM (
  SELECT 'sample'::text AS section, 'rows'::text AS key, count(*)::bigint AS n FROM draft
  UNION ALL SELECT 'sample', 'tablesample_system_percent', 1::bigint
  UNION ALL SELECT 'sample', 'draft_count_estimate', count(*)::bigint * 100 FROM draft
  UNION ALL SELECT 'field', 'caption', count(*) FILTER (WHERE has_caption) FROM draft
  UNION ALL SELECT 'field', 'docket_number', count(*) FILTER (WHERE has_docket) FROM draft
  UNION ALL SELECT 'field', 'filed_date', count(*) FILTER (WHERE has_filed) FROM draft
  UNION ALL SELECT 'field', 'terminated_date', count(*) FILTER (WHERE has_terminated) FROM draft
  UNION ALL SELECT 'field', 'nature_of_suit', count(*) FILTER (WHERE has_nos) FROM draft
  UNION ALL SELECT 'field', 'cause', count(*) FILTER (WHERE has_cause) FROM draft
  UNION ALL SELECT 'field', 'official_citation', count(*) FILTER (WHERE has_citation) FROM draft
  UNION ALL SELECT 'field', 'source_artifact', count(*) FILTER (WHERE has_artifact) FROM draft
  UNION ALL SELECT 'field', 'sealed_word', count(*) FILTER (WHERE sealed_word) FROM draft
  UNION ALL SELECT 'field', 'court_id', count(*) FROM draft
  UNION ALL SELECT 'court_type', court_type, count(*) FROM draft GROUP BY court_type
  UNION ALL SELECT 'filed_year', year_bucket, count(*) FROM draft GROUP BY year_bucket
  UNION ALL SELECT 'combo', 'caption+docket, no filed date, no nos, no cause',
    count(*) FILTER (WHERE has_caption AND has_docket AND NOT has_filed AND NOT has_nos AND NOT has_cause) FROM draft
  UNION ALL SELECT 'combo', 'caption+docket+filed date, no nos, no cause',
    count(*) FILTER (WHERE has_caption AND has_docket AND has_filed AND NOT has_nos AND NOT has_cause) FROM draft
  UNION ALL SELECT 'combo', 'caption+docket+filed date+nos',
    count(*) FILTER (WHERE has_caption AND has_docket AND has_filed AND has_nos) FROM draft
  UNION ALL SELECT 'combo', 'caption+docket+filed date+cause',
    count(*) FILTER (WHERE has_caption AND has_docket AND has_filed AND has_cause) FROM draft
  UNION ALL SELECT 'combo', 'missing caption', count(*) FILTER (WHERE NOT has_caption) FROM draft
  UNION ALL SELECT 'combo', 'missing docket number', count(*) FILTER (WHERE NOT has_docket) FROM draft
  UNION ALL SELECT 'combo', 'no filed date', count(*) FILTER (WHERE NOT has_filed) FROM draft
) census
ORDER BY section, n DESC;

SET LOCAL statement_timeout = '120s';

WITH sample AS MATERIALIZED (
  SELECT c.id, c.source_artifact_id
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  WHERE c.publication = 'draft'
)
SELECT section, key, n
FROM (
  SELECT 'related'::text AS section, 'any_party'::text AS key,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM party_appearance p WHERE p.case_id = sample.id
    ))::bigint AS n
  FROM sample
  UNION ALL SELECT 'related', 'plaintiff_and_defendant',
    count(*) FILTER (WHERE
      EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = sample.id AND p.role = 'plaintiff')
      AND EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = sample.id AND p.role = 'defendant')
    )::bigint
  FROM sample
  UNION ALL SELECT 'related', 'attorney_or_firm',
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM party_appearance p
      LEFT JOIN entity e ON e.id = p.entity_id
      WHERE p.case_id = sample.id
        AND (p.role ILIKE '%counsel%' OR p.role ILIKE '%attorney%' OR e.entity_type = 'law_firm')
    ))::bigint
  FROM sample
  UNION ALL SELECT 'related', 'judge',
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM judge_case_assignment j WHERE j.case_id = sample.id
    ))::bigint
  FROM sample
  UNION ALL SELECT 'related', 'any_docket_entry',
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM docket_entry e WHERE e.case_id = sample.id
    ))::bigint
  FROM sample
  UNION ALL SELECT 'related', 'any_document',
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM document d WHERE d.case_id = sample.id
    ))::bigint
  FROM sample
  UNION ALL SELECT 'hold', 'on_publication_hold',
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM federal_publication_hold h WHERE h.case_id = sample.id
    ))::bigint
  FROM sample
  UNION ALL SELECT 'source', coalesce(p.code, '(no source artifact)'), count(*)::bigint
  FROM sample
  LEFT JOIN raw_artifact a ON a.id = sample.source_artifact_id
  LEFT JOIN provider p ON p.id = a.provider_id
  GROUP BY 2
) related
ORDER BY section, n DESC;

SET LOCAL statement_timeout = '120s';

WITH sample AS MATERIALIZED (
  SELECT c.id
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  WHERE c.publication = 'draft'
)
SELECT 'related'::text AS section, 'median_entries_among_drafts_with_any'::text AS key,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY entry_counts.n)::bigint AS n
FROM (
  SELECT count(*)::bigint AS n
  FROM sample
  JOIN docket_entry e ON e.case_id = sample.id
  GROUP BY sample.id
) entry_counts;

SET LOCAL statement_timeout = '120s';

WITH sample AS MATERIALIZED (
  SELECT c.public_id, c.id
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  WHERE c.publication = 'draft'
    AND c.filed_on IS NULL
    AND length(btrim(coalesce(c.caption, ''))) > 0
    AND length(btrim(coalesce(c.docket_number, ''))) > 0
)
SELECT 'example'::text AS section, 'no filed date'::text AS key,
  sample.public_id || ' ' || sample.id::text AS n
FROM sample
LIMIT 3;
