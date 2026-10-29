-- Indexes that let the worker scans stop sequential-scanning the live corpus.
--
-- legal_case_draft_created_idx: the federal publication candidate query orders
-- draft cases by created_at and then LIMITs. Without a partial index that plan
-- is a parallel sequential scan (observed at 172s, several cores).
--
-- document_identifier_scotus_official_idx: official SCOTUS text extraction
-- should start from the official-opinion identifiers, not from every document.
--
-- Both are CONCURRENTLY so this migration does not take a write lock on the
-- live tables. Each index is its own committed chunk.

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_case_draft_created_idx
  ON legal_case (created_at, id)
  WHERE publication = 'draft';

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS document_identifier_scotus_official_idx
  ON document_identifier (document_id)
  WHERE identifier_type = 'scotus_official_opinion';
