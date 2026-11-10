-- The catch-up entry pass corrects a docket date by joining the event to
-- docket_entry on (case_id, provider_entry_id). The unique key is
-- (provider_id, provider_entry_id), so that predicate was not an index lookup.
-- docket_entry_case_filed_idx leads with (case_id, filed_on), which answers
-- "earliest entry date" but not "this event's entry".
--
-- The case pass already has legal_case_published_recency_idx and
-- direct_court_event_case_time_idx (case_id, official_filed_at). This migration
-- does not add a second copy of those.
--
-- Built CONCURRENTLY in its own committed chunk. That takes
-- ShareUpdateExclusive on docket_entry (writes wait, reads do not) and cannot
-- run inside a transaction. A cancelled build leaves the index INVALID;
-- scripts/migrate.mjs drops that invalid index concurrently and will not start
-- a new build while pg_dump or the previous build is still a backend.

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS docket_entry_case_provider_entry_idx
  ON docket_entry (case_id, provider_entry_id)
  WHERE provider_entry_id IS NOT NULL;

-- @commit

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'docket_entry_case_provider_entry_idx'
      AND NOT index_row.indisvalid
  ) THEN
    RAISE EXCEPTION 'docket_entry_case_provider_entry_idx is INVALID. Run DROP INDEX CONCURRENTLY IF EXISTS docket_entry_case_provider_entry_idx, then re-run migrations.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'docket_entry_case_provider_entry_idx'
  ) THEN
    RAISE EXCEPTION 'docket_entry_case_provider_entry_idx was not created';
  END IF;
END $$;
