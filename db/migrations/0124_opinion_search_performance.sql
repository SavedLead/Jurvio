-- Make public opinion search finish well under the ~60s gateway timeout.
--
-- /search loads keyword matches, an exact count, and three unfiltered facet
-- aggregations. Each of those applied two correlated "latest publication_decision"
-- lookups per opinion_search_projection row, and keyword relevance called
-- ts_rank_cd / ts_headline on the full stored opinion vector and body. On a
-- corpus of ~391k opinions that work does not fit in the gateway budget, so
-- both common terms ("securities") and case names ("Callais") returned HTTP 504.
--
-- This migration does not rewrite opinion text. It adds:
--   1. publication_current — one narrow row per case/document, the latest decision.
--   2. opinion_search_meta — narrow, trigger-maintained visibility and facet columns
--      so facets and the publication gate never scan opinion bodies.
--   3. A btree on opinion_search_projection(case_id), built CONCURRENTLY so the
--      case-level visibility trigger does not sequentially scan the projection.
--
-- Lock and runtime notes for the live database (~391k opinions, ~532k cases):
--   * Phase 1 is catalog DDL plus CREATE TRIGGER. Triggers take a brief
--     SHARE ROW EXCLUSIVE lock (writes pause for well under a second) and the
--     lock is released at the `-- @commit` below, before any backfill.
--   * The case_id index is CREATE INDEX CONCURRENTLY. It does not block reads or
--     writes. Expect about 1–5 minutes: the build scans projection heap pages
--     for the uuid column and does not read toasted opinion bodies. If a previous
--     attempt was interrupted, Postgres leaves the index INVALID and this step
--     errors with "already exists". Recover with:
--       DROP INDEX CONCURRENTLY IF EXISTS opinion_search_projection_case_id_idx;
--     then re-run migrations.
--   * The backfill is one sequential read of projection's main columns (toasted
--     bodies stay on disk) plus an index-ordered pass over publication_decision.
--     Expect about 1–3 minutes. It takes only Access Share locks on the live
--     tables, so ingestion and the public site keep running. Inserts use
--     ON CONFLICT DO NOTHING so a trigger that already wrote a newer row during
--     the backfill is not overwritten.
--   * Together this should finish inside the public-web deploy job (20 minutes).
--     release-production.sh defaults to a 300s migration budget; raise
--     MIGRATION_TIMEOUT_SECONDS if that path applies the migration on a cold disk.
--   * The new tables are unused by the currently deployed search query, so this
--     migration is safe to apply before the application that reads them.

CREATE TABLE IF NOT EXISTS publication_current (
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  displayable boolean NOT NULL,
  decided_at timestamptz NOT NULL,
  decision_id uuid NOT NULL,
  PRIMARY KEY (object_type, object_id)
);

CREATE TABLE IF NOT EXISTS opinion_search_meta (
  document_id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  court_id uuid NOT NULL,
  precedential_status text,
  opinion_type text NOT NULL,
  date_filed date,
  citation_count integer NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  visible boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS opinion_search_meta_case_idx
  ON opinion_search_meta (case_id);

CREATE INDEX IF NOT EXISTS opinion_search_meta_visible_recent_idx
  ON opinion_search_meta (date_filed DESC NULLS LAST, citation_count DESC, document_id)
  WHERE visible;

CREATE INDEX IF NOT EXISTS opinion_search_meta_visible_oldest_idx
  ON opinion_search_meta (date_filed ASC NULLS LAST, citation_count DESC, document_id)
  WHERE visible;

CREATE INDEX IF NOT EXISTS opinion_search_meta_visible_cited_idx
  ON opinion_search_meta (citation_count DESC, date_filed DESC NULLS LAST, document_id)
  WHERE visible;

CREATE INDEX IF NOT EXISTS opinion_search_meta_visible_court_recent_idx
  ON opinion_search_meta (court_id, date_filed DESC NULLS LAST, citation_count DESC, document_id)
  WHERE visible;

CREATE INDEX IF NOT EXISTS opinion_search_meta_visible_status_idx
  ON opinion_search_meta (precedential_status)
  WHERE visible AND precedential_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS opinion_search_meta_visible_type_idx
  ON opinion_search_meta (opinion_type)
  WHERE visible;

CREATE OR REPLACE FUNCTION upsert_opinion_search_meta(p_document_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO opinion_search_meta (
    document_id, case_id, court_id, precedential_status, opinion_type,
    date_filed, citation_count, visible
  )
  SELECT
    projection.document_id,
    projection.case_id,
    projection.court_id,
    projection.precedential_status,
    projection.opinion_type,
    projection.date_filed,
    projection.citation_count,
    (
      legal_case.publication = 'published'
      AND document.publication = 'published'
      AND COALESCE(case_pub.displayable, false)
      AND COALESCE(doc_pub.displayable, false)
    )
  FROM opinion_search_projection projection
  JOIN legal_case ON legal_case.id = projection.case_id
  JOIN document ON document.id = projection.document_id
  LEFT JOIN publication_current case_pub
    ON case_pub.object_type = 'legal_case' AND case_pub.object_id = projection.case_id
  LEFT JOIN publication_current doc_pub
    ON doc_pub.object_type = 'document' AND doc_pub.object_id = projection.document_id
  WHERE projection.document_id = p_document_id
  ON CONFLICT (document_id) DO UPDATE SET
    case_id = EXCLUDED.case_id,
    court_id = EXCLUDED.court_id,
    precedential_status = EXCLUDED.precedential_status,
    opinion_type = EXCLUDED.opinion_type,
    date_filed = EXCLUDED.date_filed,
    citation_count = EXCLUDED.citation_count,
    visible = EXCLUDED.visible;
$$;

CREATE OR REPLACE FUNCTION upsert_opinion_search_meta_for_case(p_case_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO opinion_search_meta (
    document_id, case_id, court_id, precedential_status, opinion_type,
    date_filed, citation_count, visible
  )
  SELECT
    projection.document_id,
    projection.case_id,
    projection.court_id,
    projection.precedential_status,
    projection.opinion_type,
    projection.date_filed,
    projection.citation_count,
    (
      legal_case.publication = 'published'
      AND document.publication = 'published'
      AND COALESCE(case_pub.displayable, false)
      AND COALESCE(doc_pub.displayable, false)
    )
  FROM opinion_search_projection projection
  JOIN legal_case ON legal_case.id = projection.case_id
  JOIN document ON document.id = projection.document_id
  LEFT JOIN publication_current case_pub
    ON case_pub.object_type = 'legal_case' AND case_pub.object_id = projection.case_id
  LEFT JOIN publication_current doc_pub
    ON doc_pub.object_type = 'document' AND doc_pub.object_id = projection.document_id
  WHERE projection.case_id = p_case_id
  ON CONFLICT (document_id) DO UPDATE SET
    case_id = EXCLUDED.case_id,
    court_id = EXCLUDED.court_id,
    precedential_status = EXCLUDED.precedential_status,
    opinion_type = EXCLUDED.opinion_type,
    date_filed = EXCLUDED.date_filed,
    citation_count = EXCLUDED.citation_count,
    visible = EXCLUDED.visible;
$$;

CREATE OR REPLACE FUNCTION refresh_opinion_search_meta_visibility(p_case_id uuid, p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE opinion_search_meta meta
  SET visible = COALESCE((
    SELECT
      legal_case.publication = 'published'
      AND document.publication = 'published'
      AND COALESCE(case_pub.displayable, false)
      AND COALESCE(doc_pub.displayable, false)
    FROM legal_case
    JOIN document ON document.id = meta.document_id
    LEFT JOIN publication_current case_pub
      ON case_pub.object_type = 'legal_case' AND case_pub.object_id = legal_case.id
    LEFT JOIN publication_current doc_pub
      ON doc_pub.object_type = 'document' AND doc_pub.object_id = document.id
    WHERE legal_case.id = meta.case_id
  ), false)
  WHERE (p_document_id IS NOT NULL AND meta.document_id = p_document_id)
     OR (p_document_id IS NULL AND meta.case_id = p_case_id);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count > 0 THEN
    RETURN;
  END IF;

  -- The narrow row does not exist yet (backfill still running, or the projection
  -- was written in a transaction that has not inserted meta). Insert it from the
  -- live projection so a newer trigger write is what the backfill's
  -- ON CONFLICT DO NOTHING leaves in place.
  IF p_document_id IS NOT NULL THEN
    PERFORM upsert_opinion_search_meta(p_document_id);
  ELSIF p_case_id IS NOT NULL THEN
    PERFORM upsert_opinion_search_meta_for_case(p_case_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION opinion_search_projection_meta_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM opinion_search_meta WHERE document_id = OLD.document_id;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.document_id IS NOT DISTINCT FROM NEW.document_id
     AND OLD.case_id IS NOT DISTINCT FROM NEW.case_id
     AND OLD.court_id IS NOT DISTINCT FROM NEW.court_id
     AND OLD.precedential_status IS NOT DISTINCT FROM NEW.precedential_status
     AND OLD.opinion_type IS NOT DISTINCT FROM NEW.opinion_type
     AND OLD.date_filed IS NOT DISTINCT FROM NEW.date_filed
     AND OLD.citation_count IS NOT DISTINCT FROM NEW.citation_count
  THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.document_id IS DISTINCT FROM NEW.document_id THEN
    DELETE FROM opinion_search_meta WHERE document_id = OLD.document_id;
  END IF;

  PERFORM upsert_opinion_search_meta(NEW.document_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION publication_decision_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_type text := COALESCE(NEW.object_type, OLD.object_type);
  target_id uuid := COALESCE(NEW.object_id, OLD.object_id);
BEGIN
  IF target_type NOT IN ('legal_case', 'document') THEN
    RETURN NULL;
  END IF;

  DELETE FROM publication_current
  WHERE object_type = target_type AND object_id = target_id;

  INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
  SELECT decision.object_type, decision.object_id, decision.displayable, decision.decided_at, decision.id
  FROM publication_decision decision
  WHERE decision.object_type = target_type
    AND decision.object_id = target_id
  ORDER BY decision.decided_at DESC, decision.id DESC
  LIMIT 1;

  IF target_type = 'document' THEN
    PERFORM refresh_opinion_search_meta_visibility(NULL, target_id);
  ELSE
    PERFORM refresh_opinion_search_meta_visibility(target_id, NULL);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION legal_case_search_visibility_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_opinion_search_meta_visibility(NEW.id, NULL);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION document_search_visibility_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_opinion_search_meta_visibility(NULL, NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS opinion_search_projection_meta_refresh ON opinion_search_projection;
CREATE TRIGGER opinion_search_projection_meta_refresh
AFTER INSERT OR UPDATE OR DELETE ON opinion_search_projection
FOR EACH ROW
EXECUTE FUNCTION opinion_search_projection_meta_trigger();

DROP TRIGGER IF EXISTS publication_decision_search_refresh ON publication_decision;
CREATE TRIGGER publication_decision_search_refresh
AFTER INSERT OR UPDATE ON publication_decision
FOR EACH ROW
WHEN (NEW.object_type IN ('legal_case', 'document'))
EXECUTE FUNCTION publication_decision_search_trigger();

DROP TRIGGER IF EXISTS publication_decision_search_refresh_delete ON publication_decision;
CREATE TRIGGER publication_decision_search_refresh_delete
AFTER DELETE ON publication_decision
FOR EACH ROW
WHEN (OLD.object_type IN ('legal_case', 'document'))
EXECUTE FUNCTION publication_decision_search_trigger();

DROP TRIGGER IF EXISTS legal_case_search_visibility ON legal_case;
CREATE TRIGGER legal_case_search_visibility
AFTER UPDATE OF publication ON legal_case
FOR EACH ROW
WHEN (OLD.publication IS DISTINCT FROM NEW.publication)
EXECUTE FUNCTION legal_case_search_visibility_trigger();

DROP TRIGGER IF EXISTS document_search_visibility ON document;
CREATE TRIGGER document_search_visibility
AFTER UPDATE OF publication ON document
FOR EACH ROW
WHEN (OLD.publication IS DISTINCT FROM NEW.publication)
EXECUTE FUNCTION document_search_visibility_trigger();

-- @commit

-- Btree on the live projection. CONCURRENTLY so ingestion writes are not blocked.
-- Must be its own migration chunk: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block. Expected build: 1–5 minutes on ~391k opinions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS opinion_search_projection_case_id_idx
  ON opinion_search_projection (case_id);

-- @commit

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS does not rebuild an index left INVALID
-- by a killed build. Fail the migration instead of recording success without it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'opinion_search_projection_case_id_idx'
      AND NOT index_row.indisvalid
  ) THEN
    RAISE EXCEPTION 'opinion_search_projection_case_id_idx is INVALID. Run DROP INDEX CONCURRENTLY IF EXISTS opinion_search_projection_case_id_idx, then re-run migrations.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'opinion_search_projection_case_id_idx'
  ) THEN
    RAISE EXCEPTION 'opinion_search_projection_case_id_idx was not created';
  END IF;
END $$;

INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
SELECT DISTINCT ON (decision.object_type, decision.object_id)
  decision.object_type,
  decision.object_id,
  decision.displayable,
  decision.decided_at,
  decision.id
FROM publication_decision decision
WHERE decision.object_type IN ('legal_case', 'document')
ORDER BY decision.object_type, decision.object_id, decision.decided_at DESC, decision.id DESC
ON CONFLICT (object_type, object_id) DO NOTHING;

INSERT INTO opinion_search_meta (
  document_id, case_id, court_id, precedential_status, opinion_type,
  date_filed, citation_count, visible
)
SELECT
  projection.document_id,
  projection.case_id,
  projection.court_id,
  projection.precedential_status,
  projection.opinion_type,
  projection.date_filed,
  projection.citation_count,
  (
    legal_case.publication = 'published'
    AND document.publication = 'published'
    AND COALESCE(case_pub.displayable, false)
    AND COALESCE(doc_pub.displayable, false)
  )
FROM opinion_search_projection projection
JOIN legal_case ON legal_case.id = projection.case_id
JOIN document ON document.id = projection.document_id
LEFT JOIN publication_current case_pub
  ON case_pub.object_type = 'legal_case' AND case_pub.object_id = projection.case_id
LEFT JOIN publication_current doc_pub
  ON doc_pub.object_type = 'document' AND doc_pub.object_id = projection.document_id
ON CONFLICT (document_id) DO NOTHING;

ANALYZE publication_current;
ANALYZE opinion_search_meta;
ANALYZE opinion_search_projection;
