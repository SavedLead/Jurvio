-- CourtListener bulk citation map + parentheticals (ADR 0090, plan PR C8).
--
-- The citation-map export (78.4M rows: citing opinion, cited opinion, depth) and
-- the parentheticals export (~6.6M) are streamed on a builder runner and written
-- here in throttled batches; nothing is downloaded to the DB server.
--
-- * courtlistener_citation_edge (0171) gets every row whose two ends are Jurvio
--   documents/cases; the edge builder folds it into case_citation_edge with depth.
-- * courtlistener_citation_unresolved keeps rows whose citing end is a Jurvio
--   document but whose cited opinion is not (compact: uuid + int + smallint),
--   for later stub resolution. courtlistener_opinion_cluster_map maps just those
--   cited opinion ids to their CL cluster (one streamed pass of the opinions
--   export); rows whose cluster Jurvio holds are then moved into the edge table.
-- * courtlistener_parenthetical keeps parentheticals written by a Jurvio
--   document. Nothing here is public by itself: every list is rebuilt through
--   the publication/sealed visibility checks.
SET lock_timeout = '60s';

CREATE TABLE IF NOT EXISTS courtlistener_citation_unresolved (
  citing_document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  cited_opinion_id integer NOT NULL,
  depth smallint NOT NULL,
  snapshot_date date NOT NULL,
  PRIMARY KEY (citing_document_id, cited_opinion_id)
);
CREATE INDEX IF NOT EXISTS courtlistener_citation_unresolved_cited_idx
  ON courtlistener_citation_unresolved (cited_opinion_id);

CREATE TABLE IF NOT EXISTS courtlistener_opinion_cluster_map (
  opinion_id integer PRIMARY KEY,
  cluster_id integer NOT NULL,
  snapshot_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS courtlistener_opinion_cluster_map_cluster_idx
  ON courtlistener_opinion_cluster_map (cluster_id);

CREATE TABLE IF NOT EXISTS courtlistener_parenthetical (
  id bigint PRIMARY KEY,
  citing_document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  described_opinion_id integer NOT NULL,
  cited_case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  text text NOT NULL,
  score real,
  group_id integer,
  snapshot_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS courtlistener_parenthetical_cited_idx
  ON courtlistener_parenthetical (cited_case_id, score DESC) WHERE cited_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS courtlistener_parenthetical_described_idx
  ON courtlistener_parenthetical (described_opinion_id) WHERE cited_case_id IS NULL;
CREATE INDEX IF NOT EXISTS courtlistener_parenthetical_citing_idx
  ON courtlistener_parenthetical (citing_document_id);

-- One row per snapshot/phase: progress, checkpoint and counts for the report.
CREATE TABLE IF NOT EXISTS courtlistener_citation_import (
  snapshot_date date NOT NULL,
  phase text NOT NULL CHECK (phase IN ('edges', 'parentheticals', 'clusters', 'finalize')),
  rows_read bigint NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (snapshot_date, phase)
);
