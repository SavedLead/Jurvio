BEGIN;
CREATE TABLE case_citation_identity (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  citation_key text NOT NULL,
  citation_label text NOT NULL,
  PRIMARY KEY (case_id, citation_key)
);
CREATE INDEX case_citation_identity_key_idx ON case_citation_identity(citation_key, case_id);
CREATE TABLE case_citation_work (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_citation_work (
  document_id uuid PRIMARY KEY REFERENCES document(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_case_citation (
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  citation_key text NOT NULL,
  citation_label text NOT NULL,
  source_content_hash text NOT NULL,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  location_kind text NOT NULL CHECK (location_kind IN ('text','html')),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  parser_version text NOT NULL,
  PRIMARY KEY (document_id, location_kind, start_offset)
);
CREATE INDEX document_case_citation_key_idx ON document_case_citation(citation_key, document_id);
CREATE TABLE missing_case_citation (
  citation_key text PRIMARY KEY,
  citation_label text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ingested','ambiguous','not_found','held')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  source_artifact_id uuid REFERENCES raw_artifact(id),
  detail text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX missing_case_citation_due_idx ON missing_case_citation(next_attempt_at) WHERE state='pending';
CREATE TABLE citation_publication_hold (
  document_id uuid PRIMARY KEY REFERENCES document(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  reasons text[] NOT NULL,
  held_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION queue_case_citation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='legal_case' THEN
    IF TG_OP='INSERT' AND NEW.official_citation IS NULL THEN RETURN NEW; END IF;
    INSERT INTO case_citation_work(case_id) VALUES (NEW.id) ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp();
  ELSE
    INSERT INTO case_citation_work(case_id) VALUES (NEW.case_id) ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp();
    IF TG_OP='UPDATE' AND OLD.case_id IS DISTINCT FROM NEW.case_id THEN
      INSERT INTO case_citation_work(case_id) VALUES (OLD.case_id) ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legal_case_citation_identity AFTER INSERT OR UPDATE OF official_citation ON legal_case
FOR EACH ROW EXECUTE FUNCTION queue_case_citation_identity();
CREATE TRIGGER opinion_cluster_citation_identity AFTER INSERT OR UPDATE OF citations, case_id, provider_cluster_id, provider_id ON opinion_cluster
FOR EACH ROW EXECUTE FUNCTION queue_case_citation_identity();
CREATE FUNCTION queue_deleted_cluster_citations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO case_citation_work(case_id) SELECT id FROM legal_case WHERE id=OLD.case_id
  ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp();
  RETURN OLD;
END $$;
CREATE TRIGGER opinion_cluster_citations_deleted AFTER DELETE ON opinion_cluster
FOR EACH ROW EXECUTE FUNCTION queue_deleted_cluster_citations();
CREATE FUNCTION queue_document_case_citations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO document_citation_work(document_id) VALUES (NEW.document_id)
  ON CONFLICT(document_id) DO UPDATE SET queued_at=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER document_case_citations_changed AFTER INSERT OR UPDATE OF content_hash, source_artifact_id ON document_content
FOR EACH ROW EXECUTE FUNCTION queue_document_case_citations();
INSERT INTO case_citation_work(case_id) SELECT id FROM legal_case c WHERE official_citation IS NOT NULL OR EXISTS(SELECT 1 FROM opinion_cluster cl WHERE cl.case_id=c.id);
INSERT INTO document_citation_work(document_id) SELECT document_id FROM document_content;
-- Count ALL identities before filtering publication: a hidden second match must
-- never turn an ambiguous citation into a falsely certain public link.
CREATE VIEW unique_case_citation AS
SELECT citation_key, min(case_id::text)::uuid AS case_id
FROM case_citation_identity GROUP BY citation_key HAVING count(*)=1;
COMMIT;
