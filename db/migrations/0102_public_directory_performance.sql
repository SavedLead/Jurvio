-- Accelerate the public case directory's publication gates and newest-first browse.
-- These indexes preserve existing publication semantics; they only remove repeated scans.

CREATE INDEX IF NOT EXISTS publication_decision_latest_object_idx
  ON publication_decision (object_type, object_id, decided_at DESC, id DESC)
  INCLUDE (displayable);

CREATE INDEX IF NOT EXISTS legal_case_public_browse_idx
  ON legal_case (
    court_id,
    COALESCE(decided_on, filed_on) DESC,
    caption,
    id
  )
  INCLUDE (public_id, docket_number, filed_on, decided_on, supreme_court_term, official_citation)
  WHERE publication = 'published';

CREATE INDEX IF NOT EXISTS document_public_case_idx
  ON document (case_id, id)
  WHERE publication = 'published';
