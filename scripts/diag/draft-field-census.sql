-- Read-only census of publication = 'draft'. One pass over those rows plus the
-- small court table. Child tables are separate statements so a slow join stops
-- instead of sitting on the database.
-- Each statement may run for 10 minutes. The diagnose session caps a statement
-- at 15 minutes (statement_timeout=900s) and the job at 45 minutes.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10min';

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
  FROM legal_case c
  JOIN court ON court.id = c.court_id
  WHERE c.publication = 'draft'
)
SELECT section, key, n
FROM (
  SELECT 'total'::text AS section, 'drafts'::text AS key, count(*)::bigint AS n FROM draft
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

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, key, n
FROM (
  SELECT 'any_party'::text AS key,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = c.id))::bigint AS n
  FROM legal_case c WHERE c.publication = 'draft'
) s;

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, key, n
FROM (
  SELECT 'plaintiff_and_defendant'::text AS key,
    count(*) FILTER (WHERE
      EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = c.id AND p.role = 'plaintiff')
      AND EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = c.id AND p.role = 'defendant')
    )::bigint AS n
  FROM legal_case c WHERE c.publication = 'draft'
) s;

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, key, n
FROM (
  SELECT 'attorney_or_firm'::text AS key,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM party_appearance p
      LEFT JOIN entity e ON e.id = p.entity_id
      WHERE p.case_id = c.id
        AND (p.role ILIKE '%counsel%' OR p.role ILIKE '%attorney%' OR e.entity_type = 'law_firm')
    ))::bigint AS n
  FROM legal_case c WHERE c.publication = 'draft'
) s;

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, key, n
FROM (
  SELECT 'judge'::text AS key,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM judge_case_assignment j WHERE j.case_id = c.id))::bigint AS n
  FROM legal_case c WHERE c.publication = 'draft'
) s;

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, key, n
FROM (
  SELECT 'any_docket_entry'::text AS key,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = c.id))::bigint AS n
  FROM legal_case c WHERE c.publication = 'draft'
) s;

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, key, n
FROM (
  SELECT 'any_document'::text AS key,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM document d WHERE d.case_id = c.id))::bigint AS n
  FROM legal_case c WHERE c.publication = 'draft'
) s;

SET LOCAL statement_timeout = '10min';

SELECT 'related'::text AS section, 'median_entries_among_drafts_with_any'::text AS key,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::bigint AS n
FROM (
  SELECT count(*)::bigint AS n
  FROM docket_entry e
  JOIN legal_case c ON c.id = e.case_id AND c.publication = 'draft'
  GROUP BY e.case_id
) entry_counts;

SET LOCAL statement_timeout = '10min';

SELECT 'hold'::text AS section, 'on_publication_hold'::text AS key, count(*)::bigint AS n
FROM legal_case c
WHERE c.publication = 'draft'
  AND EXISTS (SELECT 1 FROM federal_publication_hold h WHERE h.case_id = c.id);

SET LOCAL statement_timeout = '10min';

SELECT 'source'::text AS section, coalesce(p.code, '(no source artifact)') AS key, count(*)::bigint AS n
FROM legal_case c
LEFT JOIN raw_artifact a ON a.id = c.source_artifact_id
LEFT JOIN provider p ON p.id = a.provider_id
WHERE c.publication = 'draft'
GROUP BY 2
ORDER BY n DESC;

SET LOCAL statement_timeout = '10min';

SELECT 'example'::text AS section, bucket AS key, public_id || ' ' || id::text AS n
FROM (
  SELECT 'no filed date'::text AS bucket, c.public_id, c.id
  FROM legal_case c
  WHERE c.publication = 'draft' AND c.filed_on IS NULL
    AND length(btrim(coalesce(c.caption, ''))) > 0
    AND length(btrim(coalesce(c.docket_number, ''))) > 0
  LIMIT 3
) samples;
