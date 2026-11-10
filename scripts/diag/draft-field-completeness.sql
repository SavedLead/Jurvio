-- Read-only draft completeness. Column counts are exact. Child-table
-- presence (judge, parties, docket lines, opinion text) is a 1% block sample.
SELECT now() AS measured_at;

SELECT count(*)::bigint AS draft_cases
FROM legal_case
WHERE publication = 'draft';

SELECT
  CASE
    WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus'
      OR court.name ~* 'supreme court of the united states' THEN 'supreme'
    WHEN upper(coalesce(court.jurisdiction, '')) = 'FS' THEN 'other'
    WHEN upper(coalesce(court.jurisdiction, '')) IN ('F', 'FEDERAL APPELLATE')
      OR court.name ~* 'court of appeals|circuit' THEN 'appellate'
    WHEN upper(coalesce(court.jurisdiction, '')) IN ('FB', 'FBP')
      OR court.name ~* 'bankruptcy' THEN 'bankruptcy'
    WHEN upper(coalesce(court.jurisdiction, '')) IN ('FD', 'FEDERAL DISTRICT')
      OR court.name ~* 'district' THEN 'district'
    ELSE 'other'
  END AS court_level,
  count(*)::bigint AS drafts,
  count(*) FILTER (WHERE length(btrim(c.caption)) > 0)::bigint AS caption,
  count(*) FILTER (WHERE length(btrim(c.docket_number)) > 0)::bigint AS docket_number,
  count(*) FILTER (WHERE c.filed_on IS NOT NULL)::bigint AS filed_on,
  count(*) FILTER (WHERE nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL)::bigint AS cause,
  count(*) FILTER (WHERE nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL)::bigint AS nature_of_suit,
  count(*) FILTER (WHERE
    length(btrim(c.caption)) = 0
    AND length(btrim(c.docket_number)) = 0
    AND c.filed_on IS NULL
    AND nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NULL
    AND nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NULL
  )::bigint AS none_of_caption_docket_filed_cause_nos,
  count(*) FILTER (WHERE c.caption ~* '\m(sealed|under seal)\M')::bigint AS sealed_caption
FROM legal_case c
JOIN court ON court.id = c.court_id
WHERE c.publication = 'draft'
GROUP BY 1
ORDER BY 2 DESC;

SELECT
  count(*)::bigint AS draft_holds,
  count(*) FILTER (WHERE h.reasons && ARRAY['duplicate_identity_collision', 'missing_stable_identity']::text[])::bigint AS identity_or_collision,
  count(*) FILTER (WHERE 'restricted_or_sensitive' = ANY (h.reasons))::bigint AS restricted_hold,
  count(*) FILTER (WHERE 'duplicate_identity_collision' = ANY (h.reasons))::bigint AS collision_hold,
  count(*) FILTER (WHERE 'missing_stable_identity' = ANY (h.reasons))::bigint AS missing_identity_hold
FROM federal_publication_hold h
JOIN legal_case c ON c.id = h.case_id
WHERE c.publication = 'draft';

SELECT reason, count(*)::bigint AS drafts
FROM federal_publication_hold h
JOIN legal_case c ON c.id = h.case_id AND c.publication = 'draft'
CROSS JOIN LATERAL unnest(h.reasons) AS reason
GROUP BY reason
ORDER BY 2 DESC
LIMIT 20;

WITH sample AS MATERIALIZED (
  SELECT c.id
  FROM legal_case c TABLESAMPLE SYSTEM (1)
  WHERE c.publication = 'draft'
)
SELECT
  (SELECT count(*)::bigint FROM sample) AS sample_n,
  (SELECT count(*)::bigint FROM sample s WHERE EXISTS (
    SELECT 1 FROM judge_case_assignment a WHERE a.case_id = s.id)) AS with_judge,
  (SELECT count(*)::bigint FROM sample s WHERE EXISTS (
    SELECT 1 FROM party_appearance p WHERE p.case_id = s.id)) AS with_parties,
  (SELECT count(*)::bigint FROM sample s WHERE EXISTS (
    SELECT 1 FROM docket_entry e WHERE e.case_id = s.id)) AS with_docket_entries,
  (SELECT count(*)::bigint FROM sample s WHERE EXISTS (
    SELECT 1 FROM document d
    JOIN document_content content ON content.document_id = d.id
    WHERE d.case_id = s.id AND length(btrim(content.content_text)) > 40)) AS with_opinion_text;
