-- Case-page citation counts walk document_case_citation by citation_key.
-- The existing (citation_key, document_id) index still heap-fetches
-- source_content_hash for every posting. This covering index keeps that
-- probe in the index. CONCURRENTLY so the build does not take a write lock.

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS document_case_citation_key_hash_idx
  ON document_case_citation (citation_key, document_id, source_content_hash);
