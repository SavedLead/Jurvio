-- Search first load was reading opinion bodies and counting every visible
-- opinion on the request. Caption and title are enough for the first page of
-- a name query, and the court/status/type dropdowns can read a small snapshot
-- instead of grouping the whole corpus while the visitor waits.
--
-- The backfill commits in batches so it does not hold a lock across the
-- table. The GIN index is built after the batches, concurrently.

ALTER TABLE opinion_search_meta
  ADD COLUMN IF NOT EXISTS caption_vector tsvector;

CREATE TABLE IF NOT EXISTS opinion_search_facet (
  kind text NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE OR REPLACE FUNCTION upsert_opinion_search_meta(p_document_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO opinion_search_meta (
    document_id, case_id, court_id, precedential_status, opinion_type,
    date_filed, citation_count, visible, caption_vector
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
    ),
    to_tsvector('english', coalesce(projection.case_caption, '') || ' ' || coalesce(projection.title, ''))
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
    visible = EXCLUDED.visible,
    caption_vector = EXCLUDED.caption_vector;
$$;

CREATE OR REPLACE FUNCTION upsert_opinion_search_meta_for_case(p_case_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO opinion_search_meta (
    document_id, case_id, court_id, precedential_status, opinion_type,
    date_filed, citation_count, visible, caption_vector
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
    ),
    to_tsvector('english', coalesce(projection.case_caption, '') || ' ' || coalesce(projection.title, ''))
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
    visible = EXCLUDED.visible,
    caption_vector = EXCLUDED.caption_vector;
$$;

CREATE OR REPLACE FUNCTION refresh_opinion_search_facets()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE opinion_search_facet_next ON COMMIT DROP AS
  SELECT 'court'::text AS kind, court.public_id AS value, court.name AS label, count(*)::int AS count
  FROM opinion_search_meta meta
  JOIN court ON court.id = meta.court_id
  WHERE meta.visible
  GROUP BY court.id
  UNION ALL
  SELECT 'status', meta.precedential_status, meta.precedential_status, count(*)::int
  FROM opinion_search_meta meta
  WHERE meta.visible AND meta.precedential_status IS NOT NULL
  GROUP BY meta.precedential_status
  UNION ALL
  SELECT 'type', meta.opinion_type, meta.opinion_type, count(*)::int
  FROM opinion_search_meta meta
  WHERE meta.visible
  GROUP BY meta.opinion_type;

  INSERT INTO opinion_search_facet (kind, value, label, count)
  SELECT kind, value, label, count FROM opinion_search_facet_next
  ON CONFLICT (kind, value) DO UPDATE SET
    label = EXCLUDED.label,
    count = EXCLUDED.count;

  DELETE FROM opinion_search_facet facet
  WHERE NOT EXISTS (
    SELECT 1 FROM opinion_search_facet_next next
    WHERE next.kind = facet.kind AND next.value = facet.value
  );
END;
$$;

-- @commit

-- One statement. The migrator cannot call a procedure that commits, and this
-- column is unused until the new application starts, so holding the row locks
-- until this statement ends does not block a page read.
SET statement_timeout = '15min';
UPDATE opinion_search_meta meta
SET caption_vector = to_tsvector('english', coalesce(projection.case_caption, '') || ' ' || coalesce(projection.title, ''))
FROM opinion_search_projection projection
WHERE projection.document_id = meta.document_id
  AND meta.caption_vector IS NULL;
UPDATE opinion_search_meta
SET caption_vector = ''::tsvector
WHERE caption_vector IS NULL;

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS opinion_search_meta_caption_gin_idx
  ON opinion_search_meta USING gin (caption_vector)
  WHERE visible;

-- @commit

SELECT refresh_opinion_search_facets();
