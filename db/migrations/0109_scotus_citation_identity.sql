-- SCOTUS case identity: official citation, not the Term-recycled docket number.
--
-- legal_case has carried a single blanket unique constraint since the foundation
-- migration: UNIQUE (court_id, docket_number). For every court EXCEPT the Supreme
-- Court that is correct -- district/appellate docket numbers are genuinely unique
-- within a court. But there is exactly one SCOTUS court row, and historical U.S.
-- Reports docket numbers are tiny integers ("No. 5", "No. 12") that RESET EVERY
-- TERM, so "5" recurs across dozens of volumes for dozens of unrelated cases.
--
-- Result: the SCOTUS publisher's `INSERT ... ON CONFLICT (court_id, docket_number)
-- DO UPDATE` overwrote a previously-published, unrelated case every time a new
-- historical case reused a docket number. ~20,400 successfully-published opinion
-- candidates collapsed onto only ~7,900 legal_case rows (one per distinct docket
-- string). The per-candidate satellite rows (opinion_cluster, document,
-- case_identifier, judicial_opinion) are all keyed on the globally-unique
-- source_record_id and survived intact -- only the shared legal_case row was lost.
--
-- Fix, scoped so non-SCOTUS dedup is byte-for-byte unchanged:
--   * Keep docket-uniqueness for every non-SCOTUS row (supreme_court_term IS NULL),
--     which reproduces the old constraint exactly for district/appellate cases.
--   * Identify SCOTUS rows (supreme_court_term IS NOT NULL) by their official
--     reporter citation instead, which is globally unique per decided case.
-- Then re-queue the candidates that collided so the citation-keyed publisher can
-- reconstruct each distinct case on its next cycle.

-- 1. Drop the blanket unique constraint by its actual name (robust to auto-naming).
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'legal_case'::regclass
    AND contype = 'u'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'legal_case'::regclass AND attname = 'court_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'legal_case'::regclass AND attname = 'docket_number')
    ]::smallint[];
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE legal_case DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- 2. Non-SCOTUS rows keep exact docket-uniqueness (identical to the old constraint
--    for every district/appellate case, all of which have supreme_court_term NULL).
CREATE UNIQUE INDEX IF NOT EXISTS legal_case_court_docket_key
  ON legal_case (court_id, docket_number)
  WHERE supreme_court_term IS NULL;

-- 3. SCOTUS rows are identified by official citation + docket. Citation alone is
--    nearly unique but a small number of rows legitimately share a reporter cite
--    (companion/consolidated dispositions, occasional cite-parse variance); keying
--    on (citation, docket) is guaranteed unique on the current corpus -- every row
--    still carries the distinct docket the old constraint enforced -- while still
--    defeating the collapse, because two cases that merely reuse a Term docket now
--    differ by citation. supreme_court_term is the SCOTUS discriminator.
CREATE UNIQUE INDEX IF NOT EXISTS legal_case_scotus_citation_key
  ON legal_case (court_id, official_citation, docket_number)
  WHERE supreme_court_term IS NOT NULL;

-- 4. Re-queue the candidates whose distinct case was overwritten by a later docket
--    collision: their case_identifier points at a legal_case whose citation is NOT
--    their own. Setting them back to pending_review makes the fixed, citation-keyed
--    publisher reconstruct each one as its own case on the next scheduler cycle
--    (the publisher's cluster/document/case_identifier upserts re-point the existing
--    satellite rows via ON CONFLICT ... DO UPDATE SET case_id). Idempotent: a second
--    run finds fewer mismatches as cases are split out. Workers are stopped during
--    release, so the old collapsing publisher cannot race this.
UPDATE official_opinion_candidate cand
SET review_status = 'pending_review',
    reviewer_notes = 'Requeued by 0109: docket-collapse repair, reconstruct by official citation',
    last_seen_at = now()
FROM case_identifier ci
JOIN legal_case lc ON lc.id = ci.case_id
WHERE ci.provider_id = cand.provider_id
  AND ci.identifier_type = 'scotus_official_opinion'
  AND ci.identifier_value = cand.source_record_id
  AND cand.review_status = 'approved'
  AND cand.citation IS NOT NULL
  AND lc.official_citation IS DISTINCT FROM NULLIF(btrim(cand.citation), '');
