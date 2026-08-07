-- READ-ONLY production diagnostic for P3 (outbox) and P4 (public-page perf).
-- No mutations. EXPLAIN ANALYZE runs the queries but changes no rows.
\timing on
\echo '================ INDEX PRESENCE (P4) ================'
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'publication_decision_latest_object_idx',
    'legal_case_public_browse_idx',
    'document_public_case_idx',
    'publication_decision_latest_idx'
  )
ORDER BY indexname;

\echo '================ TABLE SIZES ================'
SELECT relname, n_live_tup
FROM pg_stat_user_tables
WHERE relname IN ('legal_case','court','publication_decision','document','party_appearance','outbox_event')
ORDER BY n_live_tup DESC;

\echo '================ P4: /cases totals (unfiltered) ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*)::int AS total
FROM legal_case
JOIN court ON court.id = legal_case.court_id
WHERE legal_case.publication = 'published'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false);

\echo '================ P4: /cases rows (page 1, size 50, newest-first) ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT legal_case.public_id, legal_case.caption, legal_case.docket_number,
  legal_case.filed_on::text, legal_case.decided_on::text, legal_case.supreme_court_term,
  legal_case.official_citation, court.name,
  EXISTS (
    SELECT 1 FROM document
    WHERE document.case_id = legal_case.id AND document.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
  ) AS has_public_document
FROM legal_case
JOIN court ON court.id = legal_case.court_id
WHERE legal_case.publication = 'published'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)
ORDER BY
  COALESCE(legal_case.decided_on, legal_case.filed_on) DESC NULLS LAST,
  legal_case.caption, legal_case.id
LIMIT 50 OFFSET 0;

\echo '================ P4: /cases court facet (GROUP BY) ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT court.public_id AS value, court.name AS label, count(*)::int AS count
FROM legal_case
JOIN court ON court.id = legal_case.court_id
WHERE legal_case.publication = 'published'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)
GROUP BY court.id, court.public_id, court.name
ORDER BY count DESC, court.name;

\echo '================ P4: /courts directory (listPublicCourts) ================'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT court.public_id, court.name, court.short_name, court.jurisdiction,
  count(legal_case.id)::int AS case_count, max(legal_case.filed_on)::text AS latest_case_date
FROM court JOIN legal_case ON legal_case.court_id = court.id
WHERE legal_case.publication = 'published'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'court' AND decision.object_id = court.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), true)
GROUP BY court.id
ORDER BY count(legal_case.id) DESC, court.name
LIMIT 100;

\echo '================ P3: outbox composition ================'
SELECT count(*) AS total,
  count(*) FILTER (WHERE published_at IS NULL) AS unpublished,
  count(*) FILTER (WHERE published_at IS NOT NULL) AS published,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  max(created_at) FILTER (WHERE published_at IS NULL) AS newest_unpublished
FROM outbox_event;

\echo '--- unpublished by topic ---'
SELECT topic, count(*) AS n, min(created_at) AS oldest, max(created_at) AS newest
FROM outbox_event WHERE published_at IS NULL GROUP BY topic ORDER BY n DESC;

\echo '--- unpublished by aggregate_type ---'
SELECT aggregate_type, count(*) AS n
FROM outbox_event WHERE published_at IS NULL GROUP BY aggregate_type ORDER BY n DESC;

\echo '--- attempts distribution (retry state) ---'
SELECT attempts, count(*) AS n
FROM outbox_event WHERE published_at IS NULL GROUP BY attempts ORDER BY attempts;

\echo '--- growth: unpublished created in last 1h / 24h / 7d ---'
SELECT
  count(*) FILTER (WHERE created_at > now() - interval '1 hour')  AS last_1h,
  count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS last_24h,
  count(*) FILTER (WHERE created_at > now() - interval '7 days')   AS last_7d
FROM outbox_event WHERE published_at IS NULL;

\echo '--- are the referenced legal_case aggregates already published/live? (sample of 5000 newest) ---'
WITH sample AS (
  SELECT aggregate_id FROM outbox_event
  WHERE published_at IS NULL AND aggregate_type = 'legal_case'
  ORDER BY created_at DESC LIMIT 5000
)
SELECT lc.publication, count(*) AS n
FROM sample s JOIN legal_case lc ON lc.id = s.aggregate_id
GROUP BY lc.publication ORDER BY n DESC;
