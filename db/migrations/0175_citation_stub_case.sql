-- Lightweight stub pages for cited cases Jurvio does not hold yet (ADR 0090, C9).
--
-- ~414k CourtListener clusters are cited by Jurvio opinions and were resolved
-- from the citation text (missing_case_citation.state = 'resolved'), but their
-- dockets are not imported, so the reader sees only an unlinked citation. A stub
-- keeps the few facts CourtListener's cluster export already gave us (name,
-- date, citations) so the citation can link to a small page listing the Jurvio
-- cases that cite it. Stubs are NOT cases: they are noindex, never in a sitemap,
-- and never built for restricted clusters or sealed-looking captions. Copied out
-- of the unlogged courtlistener_pending_cluster, which can be pruned or emptied.
SET lock_timeout = '60s';

CREATE TABLE IF NOT EXISTS citation_stub_case (
  cluster_id bigint PRIMARY KEY,
  case_name text NOT NULL,
  date_filed date,
  precedential_status text,
  citation_labels text[] NOT NULL DEFAULT '{}',
  snapshot_date date,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS citation_stub_build (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cursor_cluster_id bigint,
  pass_started_at timestamptz,
  pass_completed_at timestamptz
);
INSERT INTO citation_stub_build (id) VALUES (true) ON CONFLICT DO NOTHING;
