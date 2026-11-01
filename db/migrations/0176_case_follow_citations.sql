-- Citation follows (citation web plan, PR 19 "citation alerts"; ADR 0090).
--
-- A case follow now has two independent kinds, chosen in the case page's
-- Follow box:
--   activity  = new docket entries (the existing #605 alerts; default on)
--   citations = new opinions on Jurvio that cite this case (natural for old
--               or closed cases)
-- One row per (user, case) either way, so per-plan follow limits keep
-- counting followed cases. A row with neither kind is deleted.
--
-- Citation alerts read case_citation_edge.first_seen_at (A2) newer than
-- last_alerted_citation_at, only for edges that came from Jurvio's own parse
-- of a newly ingested, recently filed document (never from the first full
-- sweep, the CourtListener citation-map import or backlog parsing).

ALTER TABLE case_follow
  ADD COLUMN IF NOT EXISTS activity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS citations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_alerted_citation_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE case_follow DROP CONSTRAINT IF EXISTS case_follow_kind_check;
ALTER TABLE case_follow ADD CONSTRAINT case_follow_kind_check CHECK (activity OR citations);
CREATE INDEX IF NOT EXISTS case_follow_citations_case_idx ON case_follow (case_id) WHERE citations;

-- Alert scan: new edges by first_seen_at.
CREATE INDEX IF NOT EXISTS case_citation_edge_first_seen_idx ON case_citation_edge (first_seen_at);

-- Signed-out follows (magic link and waitlist) remember which kinds were
-- ticked: bit 1 activity, bit 2 citations.
ALTER TABLE auth_login_token ADD COLUMN IF NOT EXISTS follow_kinds smallint NOT NULL DEFAULT 1;
ALTER TABLE lead_waitlist ADD COLUMN IF NOT EXISTS follow_kinds smallint NOT NULL DEFAULT 1;
ALTER TABLE auth_login_token DROP CONSTRAINT IF EXISTS auth_login_token_follow_kinds_check;
ALTER TABLE auth_login_token ADD CONSTRAINT auth_login_token_follow_kinds_check CHECK (follow_kinds BETWEEN 1 AND 3);
ALTER TABLE lead_waitlist DROP CONSTRAINT IF EXISTS lead_waitlist_follow_kinds_check;
ALTER TABLE lead_waitlist ADD CONSTRAINT lead_waitlist_follow_kinds_check CHECK (follow_kinds BETWEEN 1 AND 3);
