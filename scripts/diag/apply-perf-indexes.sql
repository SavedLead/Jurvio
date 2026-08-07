-- Build the public-directory performance indexes on the LIVE database without
-- blocking ingestion writes. CONCURRENTLY must run outside a transaction, so this
-- file relies on psql autocommit (do NOT wrap in BEGIN/COMMIT). Names and shapes
-- match migrations 0102/0103 so the migration runner's IF NOT EXISTS is a no-op
-- afterwards. Each is a partial index over published rows only.

-- (0102) court_id-leading partial index: serves the court GROUP BY facets on
-- /cases and /courts with an ordered index scan instead of a disk-spilling sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_case_public_browse_idx
  ON legal_case (
    court_id,
    COALESCE(decided_on, filed_on) DESC,
    caption,
    id
  )
  INCLUDE (public_id, docket_number, filed_on, decided_on, supreme_court_term, official_citation)
  WHERE publication = 'published';

-- (0102) published-document lookup: turns the has_public_document EXISTS from a
-- full document seq scan into a case_id index probe.
CREATE INDEX CONCURRENTLY IF NOT EXISTS document_public_case_idx
  ON document (case_id, id)
  WHERE publication = 'published';

-- (0103) global newest-first partial index: serves the unfiltered /cases page's
-- ORDER BY COALESCE(decided_on, filed_on) DESC + LIMIT with an ordered scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_case_published_recency_idx
  ON legal_case (
    (COALESCE(decided_on, filed_on)) DESC NULLS LAST,
    caption,
    id
  )
  WHERE publication = 'published';
