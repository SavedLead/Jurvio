-- Why drafts that have a caption, docket, filed date, and NOS or cause
-- still are not published by scripts/bulk-publish-complete-drafts.sh.
-- Same 1% page sample as draft-field-census-sample.sql (REPEATABLE 42).
-- Counts below are inside that sample. Scale by 100, as with the census.
-- Read only. Each statement stops at 120s. Lock wait stops at 3s.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

WITH draft AS MATERIALIZED (
  SELECT
    court.id IS NOT NULL AS has_court,
    lower(coalesce(court.provider_court_id, '')) = 'scotus' AS scotus,
    length(btrim(c.caption)) > 0 AS has_caption,
    length(btrim(c.docket_number)) > 0 AS has_docket,
    c.filed_on IS NOT NULL AS has_filed,
    (
      nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL
    ) AS has_nos_or_cause,
    (concat_ws(' ', c.caption, c.docket_number) ~* '\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M') AS sealed,
    EXISTS (
      SELECT 1 FROM federal_publication_hold hold
      WHERE hold.case_id = c.id
    ) AS any_hold,
    EXISTS (
      SELECT 1 FROM federal_publication_hold hold
      WHERE hold.case_id = c.id
        AND hold.rule_version = 'federal-publication-v3'
        AND NOT (
          cardinality(hold.reasons) > 0
          AND hold.reasons <@ ARRAY[
            'missing_readable_content',
            'unverified_court_record',
            'missing_source_artifact',
            'missing_source_url',
            'invalid_source_checksum',
            'missing_retrieval_timestamp'
          ]::text[]
        )
    ) AS blocking_hold
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  LEFT JOIN court ON court.id = c.court_id
  WHERE c.publication = 'draft'
),
gap AS (
  SELECT *
  FROM draft
  WHERE has_caption
    AND has_docket
    AND has_filed
    AND has_nos_or_cause
)
SELECT section, key, n
FROM (
  SELECT 'sample'::text AS section, 'rows'::text AS key, count(*)::bigint AS n FROM draft
  UNION ALL SELECT 'population', 'caption_docket_filed_nos_or_cause', count(*)::bigint FROM gap
  UNION ALL SELECT 'fail', 'scotus', count(*) FILTER (WHERE scotus)::bigint FROM gap
  UNION ALL SELECT 'fail', 'sealed', count(*) FILTER (WHERE sealed)::bigint FROM gap
  UNION ALL SELECT 'fail', 'blocking_hold', count(*) FILTER (WHERE blocking_hold)::bigint FROM gap
  UNION ALL SELECT 'fail', 'any_hold', count(*) FILTER (WHERE any_hold)::bigint FROM gap
  UNION ALL SELECT 'fail', 'hold_not_blocking', count(*) FILTER (WHERE any_hold AND NOT blocking_hold)::bigint FROM gap
  UNION ALL SELECT 'fail', 'missing_court', count(*) FILTER (WHERE NOT has_court)::bigint FROM gap
  UNION ALL SELECT 'pass', 'all_bulk_conditions',
    count(*) FILTER (
      WHERE has_court AND NOT scotus AND NOT sealed AND NOT blocking_hold
    )::bigint
  FROM gap
  UNION ALL SELECT 'exclusive', 'missing_court', count(*) FILTER (WHERE NOT has_court)::bigint FROM gap
  UNION ALL SELECT 'exclusive', 'scotus', count(*) FILTER (WHERE has_court AND scotus)::bigint FROM gap
  UNION ALL SELECT 'exclusive', 'blocking_hold',
    count(*) FILTER (WHERE has_court AND NOT scotus AND blocking_hold)::bigint FROM gap
  UNION ALL SELECT 'exclusive', 'sealed',
    count(*) FILTER (WHERE has_court AND NOT scotus AND NOT blocking_hold AND sealed)::bigint FROM gap
  UNION ALL SELECT 'exclusive', 'pass_all',
    count(*) FILTER (WHERE has_court AND NOT scotus AND NOT sealed AND NOT blocking_hold)::bigint FROM gap
) gap_counts
ORDER BY section, n DESC;
