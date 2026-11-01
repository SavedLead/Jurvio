-- Tier 1 + Tier 2 publishable drafts (same rules as diagnose-publication-tiers-once.yml).
-- Session-local: builds TEMP TABLE tier_candidate and nothing else. No real table is written.
--   Tier 1: opinion_cluster row, or case_citation_count with cited/cited_by/cited_on_jurvio > 0.
--   Tier 2: not Tier 1, filed_on in [current_date - 90, current_date + 1].
-- Gate (all must pass, else excluded):
--   draft; caption not sealed/sensitive; no restricted_or_sensitive federal hold; no federal hold
--   with any reason other than missing_readable_content; verification not conflict/needs_review;
--   court registry-verified (SCOTUS exempt, as in the diagnostic); no non-displayable
--   publication_decision; no rejected/needs_changes/unapproved publication_review; and, for
--   SCOTUS, not a duplicate of an already-published SCOTUS case (same normalized docket number
--   or same official citation).
CREATE TEMP TABLE tier_candidate AS
WITH t1 AS (
  SELECT case_id FROM opinion_cluster
  UNION
  SELECT case_id FROM case_citation_count WHERE cited > 0 OR cited_by > 0 OR cited_on_jurvio > 0
), base AS (
  SELECT lc.id, lc.public_id, lc.caption, lc.docket_number, lc.official_citation, lc.verification, lc.court_id,
         CASE WHEN t1.case_id IS NOT NULL THEN 1 ELSE 2 END AS tier,
         CASE WHEN lower(coalesce(ct.provider_court_id, '')) = 'scotus' THEN '1_scotus'
              WHEN upper(btrim(coalesce(ct.jurisdiction, ''))) = 'F' OR ct.jurisdiction ILIKE '%appellate%' THEN '2_appeals'
              WHEN upper(btrim(coalesce(ct.jurisdiction, ''))) = 'FD' OR ct.jurisdiction ILIKE '%district%' THEN '3_district'
              ELSE '4_other' END AS court_type,
         ct.verification AS court_verification
    FROM legal_case lc
    JOIN court ct ON ct.id = lc.court_id
    LEFT JOIN t1 ON t1.case_id = lc.id
   WHERE lc.publication = 'draft'
     AND (t1.case_id IS NOT NULL OR (lc.filed_on >= current_date - 90 AND lc.filed_on <= current_date + 1))
), gated AS (
  SELECT b.*,
    CASE
      WHEN b.caption ~* '\y(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\y' THEN 'sealed_or_sensitive'
      WHEN EXISTS (SELECT 1 FROM federal_publication_hold h WHERE h.case_id = b.id AND 'restricted_or_sensitive' = ANY (h.reasons)) THEN 'sealed_or_sensitive'
      WHEN b.verification IN ('conflict', 'needs_review') THEN 'case_conflict_or_review'
      WHEN b.court_type <> '1_scotus' AND b.court_verification IS DISTINCT FROM 'verified' THEN 'court_unverified'
      WHEN EXISTS (SELECT 1 FROM federal_publication_hold h, unnest(h.reasons) r
                    WHERE h.case_id = b.id AND r <> 'missing_readable_content') THEN 'other_federal_hold'
      WHEN EXISTS (SELECT 1 FROM publication_decision pd
                    WHERE pd.object_type = 'legal_case' AND pd.object_id = b.id AND NOT pd.displayable) THEN 'prior_non_displayable_decision'
      WHEN EXISTS (SELECT 1 FROM publication_review pr
                    WHERE pr.object_id = b.id
                      AND (pr.status IN ('rejected', 'needs_changes') OR (pr.reviewer_id IS NOT NULL AND pr.status <> 'approved'))) THEN 'publication_review_block'
      WHEN b.court_type = '1_scotus' AND EXISTS (
             SELECT 1 FROM legal_case p
              WHERE p.court_id = b.court_id AND p.publication = 'published' AND p.id <> b.id
                AND ((nullif(lower(regexp_replace(b.docket_number, '[^a-zA-Z0-9]', '', 'g')), '') IS NOT NULL
                      AND lower(regexp_replace(p.docket_number, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(b.docket_number, '[^a-zA-Z0-9]', '', 'g')))
                  OR (nullif(btrim(b.official_citation), '') IS NOT NULL AND p.official_citation = b.official_citation))) THEN 'scotus_duplicate_of_published'
      ELSE 'ok' END AS gate
    FROM base b
)
SELECT * FROM gated;

\echo '--- candidates (tier | court_type | gate | cases) ---'
SELECT tier, court_type, gate, count(*) FROM tier_candidate GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
\echo '--- publishable (gate ok) by tier (tier | cases) ---'
SELECT tier, count(*) FROM tier_candidate WHERE gate = 'ok' GROUP BY 1 ORDER BY 1;
