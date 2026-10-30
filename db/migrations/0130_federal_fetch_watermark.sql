-- Fetch watermarks for the federal loops. Nullable columns with no table
-- rewrite: last_fetched_at stays null until a docket is actually fetched, so
-- those rows sort first. The partial index is built outside this transaction.

ALTER TABLE legal_case
  ADD COLUMN IF NOT EXISTS last_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_http_etag text,
  ADD COLUMN IF NOT EXISTS source_http_last_modified text;

ALTER TABLE appellate_source_registry
  ADD COLUMN IF NOT EXISTS listing_etag text,
  ADD COLUMN IF NOT EXISTS listing_last_modified text;

ALTER TABLE direct_court_registry
  ADD COLUMN IF NOT EXISTS feed_etag text,
  ADD COLUMN IF NOT EXISTS feed_last_modified text;

CREATE TABLE IF NOT EXISTS federal_cluster_watermark (
  provider_court_id text PRIMARY KEY,
  newest_cluster_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- @commit

-- Open, non-restricted cases in fetch order. Matches the active-case query.
-- CONCURRENTLY so the 34 GB database is not write-locked for the build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_case_open_refetch_idx
  ON legal_case (last_fetched_at NULLS FIRST, id)
  WHERE terminated_on IS NULL
    AND activity_state = 'active'
    AND publication <> 'restricted';
