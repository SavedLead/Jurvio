-- Global newest-first browse index for the public /cases listing.
--
-- 0102 added a court_id-leading partial index (great for court-filtered browse
-- and the court GROUP BY facets) plus a published-document index. The unfiltered
-- /cases listing, however, orders by COALESCE(decided_on, filed_on) DESC across
-- ALL published cases and takes only the first page. Without an index in that
-- exact order the planner sequential-scans ~187k published rows and top-N sorts
-- them on every cold request. This partial index lets that page be served by an
-- ordered index scan that stops after the first ~50 displayable rows.
--
-- On the live database this index is built CONCURRENTLY (see the one-off apply
-- job) so ingestion writes are never blocked; here IF NOT EXISTS keeps fresh
-- provisioning idempotent and in sync with what production already has.

CREATE INDEX IF NOT EXISTS legal_case_published_recency_idx
  ON legal_case (
    (COALESCE(decided_on, filed_on)) DESC NULLS LAST,
    caption,
    id
  )
  WHERE publication = 'published';
