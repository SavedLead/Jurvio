-- Read-only 1% page sample. How many drafts the bulk publisher would publish
-- after bulk_opinion_text_pending_review is removed from v3 holds.
-- An empty remaining reason list does not block, because the clear deletes
-- that row. A remaining non-reopenable reason still blocks.
-- draft_count_estimate = sample rows * 100. Each statement stops at 120s.
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
      nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM judge_case_assignment j WHERE j.case_id = c.id)
      OR EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = c.id)
      OR EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = c.id)
    ) AS complete_extra,
    (concat_ws(' ', c.caption, c.docket_number) ~* '\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M') AS sealed,
    c.created_at >= TIMESTAMP '2026-10-01 00:00:00' AT TIME ZONE 'America/New_York'
      AND c.created_at < TIMESTAMP '2026-12-01 00:00:00' AT TIME ZONE 'America/New_York' AS created_oct_nov_2026,
    EXISTS (
      SELECT 1
      FROM federal_publication_hold hold
      WHERE hold.case_id = c.id
        AND hold.rule_version = 'federal-publication-v3'
        AND cardinality(array_remove(hold.reasons, 'bulk_opinion_text_pending_review')) > 0
        AND NOT (
          array_remove(hold.reasons, 'bulk_opinion_text_pending_review') <@ ARRAY[
            'missing_readable_content',
            'unverified_court_record',
            'missing_source_artifact',
            'missing_source_url',
            'invalid_source_checksum',
            'missing_retrieval_timestamp'
          ]::text[]
        )
    ) AS still_blocking
  FROM legal_case c TABLESAMPLE SYSTEM (1) REPEATABLE (42)
  JOIN court ON court.id = c.court_id
  WHERE c.publication = 'draft'
)
SELECT section, key, n
FROM (
  SELECT 'sample'::text AS section, 'rows'::text AS key, count(*)::bigint AS n FROM draft
  UNION ALL SELECT 'publishable_after_clear', 'rows',
    count(*) FILTER (
      WHERE has_court AND NOT scotus AND has_caption AND has_docket AND has_filed
        AND complete_extra AND NOT sealed AND NOT still_blocking
    )::bigint
  FROM draft
  UNION ALL SELECT 'publishable_after_clear', 'estimate_times_100',
    count(*) FILTER (
      WHERE has_court AND NOT scotus AND has_caption AND has_docket AND has_filed
        AND complete_extra AND NOT sealed AND NOT still_blocking
    )::bigint * 100
  FROM draft
  UNION ALL SELECT 'publishable_after_clear', 'created_oct_nov_2026',
    count(*) FILTER (
      WHERE has_court AND NOT scotus AND has_caption AND has_docket AND has_filed
        AND complete_extra AND NOT sealed AND NOT still_blocking
        AND created_oct_nov_2026
    )::bigint
  FROM draft
  UNION ALL SELECT 'publishable_after_clear', 'created_oct_nov_2026_estimate_times_100',
    count(*) FILTER (
      WHERE has_court AND NOT scotus AND has_caption AND has_docket AND has_filed
        AND complete_extra AND NOT sealed AND NOT still_blocking
        AND created_oct_nov_2026
    )::bigint * 100
  FROM draft
  UNION ALL SELECT 'still_blocked', 'other_v3_reason',
    count(*) FILTER (
      WHERE has_court AND NOT scotus AND has_caption AND has_docket AND has_filed
        AND complete_extra AND NOT sealed AND still_blocking
    )::bigint
  FROM draft
) counted
ORDER BY section, key;
