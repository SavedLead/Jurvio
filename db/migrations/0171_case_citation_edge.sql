-- Precomputed Cites / Cited-by lists and dirty-set counts (citation web plan,
-- PRs A2 + A3; ADR 0090).
--
-- case_citation_edge: one row per (citing case, cited case), both ends
-- published, displayable and not sealed-caption at build time. Case pages read
-- the first page of either direction by index instead of the live DISTINCT ON
-- join over every posting of a cite key (EXPLAIN 4.8 s for a popular key).
--   sources bit 1 = Jurvio's own parse (document_case_citation)
--   sources bit 2 = CourtListener bulk citation map (courtlistener_citation_edge)
--
-- courtlistener_citation_edge: CourtListener citation-map rows whose citing
-- opinion is a Jurvio document and whose cited opinion maps to a Jurvio case
-- (filled by the C8 import; empty until then). depth = times cited.
--
-- citation_dirty_case: cases whose edges / counts must be recomputed.
--   direction bit 1 = outgoing (its opinions changed), bit 2 = incoming (its
--   cite identities or visibility changed). Written by the citation worker and
--   the publication triggers below; drained by the citation-edges job.
--
-- citation_edge_build: single-row state of the resumable full sweep. Pages use
-- the precomputed lists only after the first full sweep has completed.

-- Trigger DDL briefly locks legal_case, document and publication_decision.
-- Fail fast instead of queueing every writer behind a long bulk transaction.
SET lock_timeout = '60s';

CREATE TABLE IF NOT EXISTS courtlistener_citation_edge (
  citing_document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  cited_case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  depth smallint NOT NULL DEFAULT 1,
  snapshot_date date NOT NULL,
  PRIMARY KEY (citing_document_id, cited_case_id)
);
CREATE INDEX IF NOT EXISTS courtlistener_citation_edge_cited_idx
  ON courtlistener_citation_edge (cited_case_id);

CREATE TABLE IF NOT EXISTS case_citation_edge (
  citing_case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  cited_case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  citing_document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  citation_label text,
  mentions integer NOT NULL DEFAULT 0,
  depth integer,
  sources smallint NOT NULL,
  citing_filed_on date,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  -- When this citing-case -> cited-case pair first appeared (kept by upserts);
  -- citation-follow alerts read it together with citing_filed_on.
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (citing_case_id, cited_case_id)
);
CREATE INDEX IF NOT EXISTS case_citation_edge_cited_idx
  ON case_citation_edge (cited_case_id, citing_filed_on DESC NULLS LAST, citing_case_id);
CREATE INDEX IF NOT EXISTS case_citation_edge_document_idx
  ON case_citation_edge (citing_document_id);

CREATE TABLE IF NOT EXISTS citation_dirty_case (
  case_id uuid PRIMARY KEY,
  direction smallint NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS citation_dirty_case_order_idx ON citation_dirty_case (queued_at, case_id);

CREATE TABLE IF NOT EXISTS citation_edge_build (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  sweep_started_at timestamptz,
  sweep_cursor uuid,
  sweep_completed_at timestamptz,
  -- Start time of the last completed sweep: everything changed before it is covered.
  sweep_covered_from timestamptz,
  -- A bulk change (e.g. the CourtListener citation-map import) asks for a sweep now.
  sweep_requested_at timestamptz,
  first_completed_at timestamptz
);
INSERT INTO citation_edge_build (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION mark_citation_dirty(target uuid, bits smallint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO citation_dirty_case(case_id, direction) VALUES (target, bits)
  ON CONFLICT (case_id) DO UPDATE SET direction = citation_dirty_case.direction | EXCLUDED.direction,
    queued_at = clock_timestamp();
$$;

-- Visibility changes. Only published cases matter: draft churn from ingestion
-- never touches the lists.
CREATE OR REPLACE FUNCTION citation_dirty_on_case_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mark_citation_dirty(NEW.id, 3::smallint);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS legal_case_citation_dirty ON legal_case;
CREATE TRIGGER legal_case_citation_dirty AFTER UPDATE OF publication, caption, docket_number ON legal_case
FOR EACH ROW WHEN ((OLD.publication = 'published' OR NEW.publication = 'published')
  AND (OLD.publication IS DISTINCT FROM NEW.publication OR OLD.caption IS DISTINCT FROM NEW.caption
    OR OLD.docket_number IS DISTINCT FROM NEW.docket_number))
EXECUTE FUNCTION citation_dirty_on_case_change();

CREATE OR REPLACE FUNCTION citation_dirty_on_document_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mark_citation_dirty(NEW.case_id, 1::smallint);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS document_citation_dirty ON document;
CREATE TRIGGER document_citation_dirty AFTER UPDATE OF publication ON document
FOR EACH ROW WHEN ((OLD.publication = 'published' OR NEW.publication = 'published')
  AND OLD.publication IS DISTINCT FROM NEW.publication)
EXECUTE FUNCTION citation_dirty_on_document_change();

CREATE OR REPLACE FUNCTION citation_dirty_on_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF NEW.object_type = 'legal_case' THEN
    SELECT id INTO target FROM legal_case WHERE id = NEW.object_id AND publication = 'published';
    IF target IS NOT NULL THEN PERFORM mark_citation_dirty(target, 3::smallint); END IF;
  ELSIF NEW.object_type = 'document' THEN
    SELECT d.case_id INTO target FROM document d WHERE d.id = NEW.object_id AND d.publication = 'published';
    IF target IS NOT NULL THEN PERFORM mark_citation_dirty(target, 1::smallint); END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS publication_decision_citation_dirty ON publication_decision;
CREATE TRIGGER publication_decision_citation_dirty AFTER INSERT ON publication_decision
FOR EACH ROW EXECUTE FUNCTION citation_dirty_on_decision();

-- Subscriber-only (sealed-style, #610) cases: a restricted docket event makes the
-- case search-excluded, so its edges must be rebuilt without it.
CREATE OR REPLACE FUNCTION citation_dirty_on_restricted_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mark_citation_dirty(NEW.case_id, 3::smallint);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS direct_court_event_citation_dirty ON direct_court_event;
CREATE TRIGGER direct_court_event_citation_dirty AFTER INSERT OR UPDATE OF restricted, case_id ON direct_court_event
FOR EACH ROW WHEN (NEW.restricted AND NEW.case_id IS NOT NULL)
EXECUTE FUNCTION citation_dirty_on_restricted_event();
