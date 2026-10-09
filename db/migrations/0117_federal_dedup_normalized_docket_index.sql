-- Speeds up the bulk-ingestion ensureCase dedup lookup, which matches an existing
-- case by its court and its PUNCTUATION-NORMALIZED docket number:
--   lower(regexp_replace(docket_number, '[^a-zA-Z0-9]', '', 'g'))
-- Without this index that lookup is a full sequential scan of legal_case
-- (~1.5s per case at 600k+ rows, confirmed by EXPLAIN ANALYZE), which was the
-- federal bulk-ingestion write bottleneck.
--
-- The expression is IMMUTABLE (lower + 4-arg regexp_replace) and matches the dedup
-- query exactly, so the planner can use it. This indexes the EXISTING normalization
-- only; it does not change which dockets are considered the same case.
--
-- On production this index is created out-of-band and CONCURRENTLY (see
-- .github/workflows/create-federal-dedup-index-once.yml) so the live legal_case
-- table is never locked; this statement then no-ops. On a fresh/empty database it
-- builds instantly. (CREATE INDEX CONCURRENTLY cannot run inside the migration
-- runner's transaction, which is why production creation is out-of-band.)
CREATE INDEX IF NOT EXISTS legal_case_normalized_docket_idx
  ON legal_case (lower(regexp_replace(docket_number, '[^a-zA-Z0-9]', '', 'g')));
