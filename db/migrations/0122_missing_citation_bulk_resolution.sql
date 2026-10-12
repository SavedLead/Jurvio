-- Offline resolution of missing case citations from CourtListener's free bulk
-- citation map (citations-<snapshot>.csv.bz2: one row per reporter citation and
-- the opinion cluster it belongs to).
--
-- Before this, every missing citation cost one call to CourtListener's rate-limited
-- citation-lookup API, at roughly ten citations every two minutes. The resolver
-- reads the bulk map once per snapshot and records the exact source cluster for
-- every missing citation it can match, with no API calls:
--   * cluster already held locally -> verified alias (existing path), linked on
--     the next identity refresh;
--   * cluster not held             -> state 'resolved' + resolved_cluster_id, so
--     discovery fetches that exact cluster (skipping the lookup call) and the
--     bulk importer can ingest all resolved clusters in one pass;
--   * citation maps to 2+ clusters -> state 'ambiguous' (never guessed);
--   * citation absent from map     -> retried by API discovery after a longer
--     backoff, since newer cases may exist after the snapshot.
-- Publication rules are unchanged: resolving a citation never publishes anything.
ALTER TABLE missing_case_citation
  ADD COLUMN IF NOT EXISTS resolved_cluster_id bigint,
  ADD COLUMN IF NOT EXISTS resolved_snapshot date;

ALTER TABLE missing_case_citation DROP CONSTRAINT IF EXISTS missing_case_citation_state_check;
ALTER TABLE missing_case_citation ADD CONSTRAINT missing_case_citation_state_check
  CHECK (state IN ('pending','resolved','ingested','ambiguous','not_found','held'));

CREATE INDEX IF NOT EXISTS missing_case_citation_resolved_idx
  ON missing_case_citation(resolved_cluster_id) WHERE state='resolved';
