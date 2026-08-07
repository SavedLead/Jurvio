-- READ-ONLY P4 re-measurement after applying the performance indexes.
\timing on
\echo '================ INDEX PRESENCE ================'
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('legal_case','document')
  AND indexname IN ('legal_case_public_browse_idx','document_public_case_idx','legal_case_published_recency_idx')
ORDER BY indexname;

\echo '================ /cases totals ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*)::int AS total
FROM legal_case JOIN court ON court.id = legal_case.court_id
WHERE legal_case.publication = 'published'
  AND COALESCE((SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type='legal_case' AND decision.object_id=legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false);

\echo '================ /cases rows (page 1, size 50) ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT legal_case.public_id, legal_case.caption, legal_case.docket_number,
  legal_case.filed_on::text, legal_case.decided_on::text, legal_case.supreme_court_term,
  legal_case.official_citation, court.name,
  EXISTS (SELECT 1 FROM document
    WHERE document.case_id = legal_case.id AND document.publication='published'
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type='document' AND decision.object_id=document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)) AS has_public_document
FROM legal_case JOIN court ON court.id = legal_case.court_id
WHERE legal_case.publication='published'
  AND COALESCE((SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type='legal_case' AND decision.object_id=legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
ORDER BY COALESCE(legal_case.decided_on, legal_case.filed_on) DESC NULLS LAST,
  legal_case.caption, legal_case.id
LIMIT 50 OFFSET 0;

\echo '================ /cases court facet (GROUP BY) ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT court.public_id, court.name, count(*)::int
FROM legal_case JOIN court ON court.id = legal_case.court_id
WHERE legal_case.publication='published'
  AND COALESCE((SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type='legal_case' AND decision.object_id=legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
GROUP BY court.id, court.public_id, court.name
ORDER BY count DESC, court.name;

\echo '================ /courts directory ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT court.public_id, court.name, court.short_name, court.jurisdiction,
  count(legal_case.id)::int, max(legal_case.filed_on)::text
FROM court JOIN legal_case ON legal_case.court_id = court.id
WHERE legal_case.publication='published'
  AND COALESCE((SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type='legal_case' AND decision.object_id=legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
  AND COALESCE((SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type='court' AND decision.object_id=court.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), true)
GROUP BY court.id
ORDER BY count(legal_case.id) DESC, court.name
LIMIT 100;
