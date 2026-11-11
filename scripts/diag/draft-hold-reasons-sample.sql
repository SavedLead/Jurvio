-- What the blocking federal_publication_hold rows are, for the same 1%
-- page sample as the draft census (REPEATABLE 42). Limited to drafts with a
-- caption, docket, filed date, and NOS or cause: the slice that failed only
-- on a blocking hold. Counts are inside the sample. Scale by 100.
-- Read only. Each statement stops at 120s. Lock wait stops at 3s.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

WITH draft AS MATERIALIZED (
  SELECT
    c.id,
    c.public_id,
    c.created_at,
    CASE
      WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus' THEN 'scotus'
      WHEN lower(coalesce(court.provider_court_id, '')) ~ '^ca([0-9]{1,2}|dc|fc)$' THEN 'appeals'
      WHEN lower(coalesce(court.provider_court_id, '')) ~ '(b|bap[0-9]*)$' THEN 'bankruptcy'
      WHEN lower(coalesce(court.provider_court_id, '')) ~ 'd$' THEN 'district'
      ELSE 'other'
    END AS court_type,
    hold.rule_version,
    hold.reasons,
    hold.held_at,
    (
      hold.rule_version = 'federal-publication-v3'
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
    ) AS blocking
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  JOIN court ON court.id = c.court_id
  JOIN federal_publication_hold hold ON hold.case_id = c.id
  WHERE c.publication = 'draft'
    AND length(btrim(c.caption)) > 0
    AND length(btrim(c.docket_number)) > 0
    AND c.filed_on IS NOT NULL
    AND (
      nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL
    )
),
blocked AS (
  SELECT * FROM draft WHERE blocking
),
reason_row AS (
  SELECT
    blocked.*,
    reason,
    CASE reason
      WHEN 'bulk_opinion_text_pending_review' THEN 'bulk opinion or cluster load'
      WHEN 'restricted_or_sensitive' THEN 'sealed or sensitive text'
      WHEN 'missing_stable_identity' THEN 'federal publisher identity'
      WHEN 'unverified_federal_court' THEN 'federal publisher court'
      WHEN 'missing_court_provider_identity' THEN 'federal publisher court'
      WHEN 'duplicate_identity_collision' THEN 'federal publisher identity'
      WHEN 'unresolved_ingestion_rejection' THEN 'federal publisher rejection'
      WHEN 'missing_readable_content' THEN 'reopenable metadata waiver'
      WHEN 'unverified_court_record' THEN 'reopenable metadata waiver'
      WHEN 'missing_source_artifact' THEN 'reopenable metadata waiver'
      WHEN 'missing_source_url' THEN 'reopenable metadata waiver'
      WHEN 'invalid_source_checksum' THEN 'reopenable metadata waiver'
      WHEN 'missing_retrieval_timestamp' THEN 'reopenable metadata waiver'
      ELSE 'other'
    END AS kind
  FROM blocked
  CROSS JOIN LATERAL unnest(blocked.reasons) AS reason
)
SELECT section, key, n
FROM (
  SELECT 'population'::text AS section, 'with_any_hold'::text AS key, count(*)::bigint AS n FROM draft
  UNION ALL SELECT 'population', 'blocking_hold', count(*)::bigint FROM blocked
  UNION ALL SELECT 'reason_set', array_to_string(reasons, ' + '), count(*)::bigint
    FROM blocked GROUP BY reasons
  UNION ALL SELECT 'reason', reason, count(*)::bigint FROM reason_row GROUP BY reason
  UNION ALL SELECT 'kind', kind, count(*)::bigint FROM reason_row GROUP BY kind
  UNION ALL SELECT 'rule_version', coalesce(rule_version, '(none)'), count(*)::bigint
    FROM blocked GROUP BY rule_version
  UNION ALL SELECT 'hold_month', to_char(held_at AT TIME ZONE 'America/New_York', 'YYYY-MM'), count(*)::bigint
    FROM blocked GROUP BY 2
  UNION ALL SELECT 'case_created_year', to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY'), count(*)::bigint
    FROM blocked GROUP BY 2
  UNION ALL SELECT 'court_type', court_type, count(*)::bigint FROM blocked GROUP BY court_type
) grouped
ORDER BY section, n DESC;

SET LOCAL statement_timeout = '120s';

WITH blocked AS MATERIALIZED (
  SELECT c.public_id, hold.reasons
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  JOIN federal_publication_hold hold ON hold.case_id = c.id
  WHERE c.publication = 'draft'
    AND length(btrim(c.caption)) > 0
    AND length(btrim(c.docket_number)) > 0
    AND c.filed_on IS NOT NULL
    AND (
      nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL
    )
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
),
ranked AS (
  SELECT
    reason,
    public_id,
    row_number() OVER (PARTITION BY reason ORDER BY public_id) AS n
  FROM blocked
  CROSS JOIN LATERAL unnest(blocked.reasons) AS reason
)
SELECT 'example'::text AS section, reason AS key, public_id AS n
FROM ranked
WHERE n <= 3
ORDER BY reason, public_id;
