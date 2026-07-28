BEGIN;

ALTER TABLE legal_case
  ADD COLUMN decided_on date,
  ADD COLUMN supreme_court_term smallint
    CHECK (supreme_court_term BETWEEN 1789 AND 2200),
  ADD COLUMN official_citation text;

COMMENT ON COLUMN legal_case.filed_on IS
  'Date the case or petition was filed, only when supported by a docket source.';
COMMENT ON COLUMN legal_case.decided_on IS
  'Date the court issued its decision, only when supported by an authoritative source.';
COMMENT ON COLUMN legal_case.supreme_court_term IS
  'Four-digit October Term year for Supreme Court matters.';
COMMENT ON COLUMN legal_case.official_citation IS
  'Official U.S. Reports citation or official slip-opinion citation when supplied by the Court.';

UPDATE legal_case AS legal_case
SET filed_on = NULL,
    decided_on = candidate.filed_on,
    supreme_court_term = 2000 + candidate.term_year::smallint,
    official_citation = NULLIF(btrim(candidate.citation), ''),
    updated_at = now()
FROM case_identifier AS identifier
JOIN provider ON provider.id = identifier.provider_id
JOIN official_opinion_candidate AS candidate
  ON candidate.provider_id = identifier.provider_id
 AND candidate.source_record_id = identifier.identifier_value
WHERE identifier.case_id = legal_case.id
  AND provider.code = 'scotus_official'
  AND identifier.identifier_type = 'scotus_official_opinion';

CREATE INDEX legal_case_scotus_term_decided_idx
  ON legal_case (supreme_court_term DESC, decided_on DESC)
  WHERE supreme_court_term IS NOT NULL;

COMMIT;
