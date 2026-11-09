-- Facet counts on /search group every visible opinion by court. After a
-- publish burst those rows are freshly updated, and the aggregate was part
-- of the multi-second search page. A partial index keeps that count off the
-- heap. Keyword search itself is capped in the application
-- (gin_fuzzy_search_limit) so a common word does not read its whole posting list.

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS opinion_search_meta_visible_court_idx
  ON opinion_search_meta (court_id)
  WHERE visible;

-- @commit

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'opinion_search_meta_visible_court_idx'
      AND NOT index_row.indisvalid
  ) THEN
    RAISE EXCEPTION 'opinion_search_meta_visible_court_idx is INVALID. Run DROP INDEX CONCURRENTLY IF EXISTS opinion_search_meta_visible_court_idx, then re-run migrations.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'opinion_search_meta_visible_court_idx'
  ) THEN
    RAISE EXCEPTION 'opinion_search_meta_visible_court_idx was not created';
  END IF;
END $$;
