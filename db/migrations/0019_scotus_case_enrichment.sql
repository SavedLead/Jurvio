BEGIN;

CREATE TABLE scotus_case_enrichment (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  official_docket_url text NOT NULL,
  docket_source_artifact_id uuid REFERENCES raw_artifact(id),
  docketed_on date,
  lower_court_name text,
  lower_court_case_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  lower_court_decided_on date,
  question_presented text,
  question_source_url text,
  question_source_locator text,
  exact_holding text,
  holding_source_url text,
  holding_source_locator text,
  background_summary text,
  background_source_url text,
  background_source_locator text,
  significance_summary text,
  significance_source_url text,
  significance_source_locator text,
  exact_disposition text,
  disposition_source_url text,
  disposition_source_locator text,
  syllabus_text text,
  syllabus_source_url text,
  syllabus_source_locator text,
  decision_lineup jsonb NOT NULL DEFAULT '{}'::jsonb,
  completeness jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification verification_state NOT NULL DEFAULT 'not_verified',
  parser_version text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (official_docket_url ~ '^https://www[.]supremecourt[.]gov/docket/docketfiles/html/public/[0-9A-Za-z-]+[.]html$'),
  CHECK (question_presented IS NULL OR (question_source_url IS NOT NULL AND question_source_locator IS NOT NULL)),
  CHECK (exact_holding IS NULL OR (holding_source_url IS NOT NULL AND holding_source_locator IS NOT NULL)),
  CHECK (background_summary IS NULL OR (background_source_url IS NOT NULL AND background_source_locator IS NOT NULL)),
  CHECK (significance_summary IS NULL OR (significance_source_url IS NOT NULL AND significance_source_locator IS NOT NULL)),
  CHECK (exact_disposition IS NULL OR (disposition_source_url IS NOT NULL AND disposition_source_locator IS NOT NULL)),
  CHECK (syllabus_text IS NULL OR (syllabus_source_url IS NOT NULL AND syllabus_source_locator IS NOT NULL))
);

CREATE TABLE scotus_docket_document (
  document_id uuid PRIMARY KEY REFERENCES document(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_record_id text NOT NULL UNIQUE,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_url ~ '^https://www[.]supremecourt[.]gov/')
);

CREATE INDEX scotus_case_enrichment_verification_idx
  ON scotus_case_enrichment (verification, updated_at DESC);

-- Correct already-published official opinions when their verified Court text identifies
-- the unsigned opinion as per curiam. This is deterministic and intentionally does not
-- infer an author, vote, join, or recusal.
UPDATE judicial_opinion judicial
SET per_curiam = true, updated_at = now()
FROM document_content content, document, legal_case, court
WHERE content.document_id = judicial.document_id
  AND document.id = judicial.document_id
  AND legal_case.id = document.case_id
  AND court.id = legal_case.court_id
  AND lower(court.provider_court_id) = 'scotus'
  AND judicial.per_curiam = false
  AND content.content_text ~* '(^|[\n\r])[[:space:]]*(PER[[:space:]]+CURIAM|Per[[:space:]]+Curiam)[[:space:]]*([\n\r]|$)';

COMMIT;
