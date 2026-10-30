-- CourtListener bulk opinion-cluster load (Step C0, before opinion text).
--
-- Opinions in the bulk export point at a cluster, and the cluster points at a docket.
-- PR #548's opinion loader could only attach opinions to clusters that already
-- existed, and production had almost none for federal dockets, so a 1.78M-row
-- measurement merged nothing (1,701,717 unmatched). The cluster loader streams the
-- opinion-clusters export and resolves cluster -> docket -> legal_case set-based.
--
-- courtlistener_cluster_stage: unlogged per-chunk stage (COPY, merge, truncate),
-- same pattern as courtlistener_docket_stage / courtlistener_opinion_stage.
--
-- courtlistener_pending_cluster: clusters whose docket is not loaded yet (the bulk
-- docket load is still running). Each cluster run first resolves these against
-- case_identifier, so a later docket load attaches them without re-reading the
-- clusters file. Rows are pruned once the docket load for their snapshot is
-- complete (an unresolved docket is then non-federal). Unlogged: no WAL for a table
-- that can briefly hold millions of rows; after a crash it is empty and the next
-- monthly cluster snapshot re-adds anything lost (cluster inserts are idempotent).
-- Slim on purpose: no long text (syllabus, headmatter, ...) is kept here.

CREATE UNLOGGED TABLE IF NOT EXISTS courtlistener_cluster_stage (
  cluster_id text NOT NULL,
  docket_id text NOT NULL,
  case_name text NOT NULL,
  date_filed date,
  precedential_status text,
  citation_count integer NOT NULL,
  judges text,
  syllabus text,
  procedural_history text,
  restricted boolean NOT NULL,
  date_modified timestamptz,
  public_id text NOT NULL,
  provider_metadata jsonb NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS courtlistener_pending_cluster (
  cluster_id text PRIMARY KEY,
  docket_id text NOT NULL,
  snapshot_date date NOT NULL,
  case_name text NOT NULL,
  date_filed date,
  precedential_status text,
  citation_count integer NOT NULL DEFAULT 0,
  judges text,
  restricted boolean NOT NULL DEFAULT false,
  date_modified timestamptz,
  public_id text NOT NULL,
  provider_metadata jsonb NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS courtlistener_pending_cluster_docket_idx
  ON courtlistener_pending_cluster (docket_id);
