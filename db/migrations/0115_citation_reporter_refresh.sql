BEGIN;
-- Source-verified parallel citations survive identity refreshes even when older
-- local cluster metadata did not contain the citation returned by source lookup.
CREATE TABLE case_citation_verified_alias (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  citation_key text NOT NULL,
  citation_label text NOT NULL,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(case_id,citation_key)
);
CREATE FUNCTION queue_verified_citation_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'DELETE' THEN
    INSERT INTO case_citation_work(case_id) SELECT id FROM legal_case WHERE id=NEW.case_id
    ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp();
  END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.case_id IS DISTINCT FROM NEW.case_id) THEN
    INSERT INTO case_citation_work(case_id) SELECT id FROM legal_case WHERE id=OLD.case_id
    ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp();
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER verified_citation_alias_changed AFTER INSERT OR UPDATE OR DELETE ON case_citation_verified_alias
FOR EACH ROW EXECUTE FUNCTION queue_verified_citation_alias();
-- Parser/alias normalization changed. Replay identities and content without
-- changing authoritative text or relaxing any publication decision.
CREATE INDEX case_citation_work_order_idx ON case_citation_work(queued_at,case_id);
CREATE INDEX document_citation_work_order_idx ON document_citation_work(queued_at,document_id);
INSERT INTO case_citation_work(case_id)
SELECT id FROM legal_case c WHERE official_citation IS NOT NULL
  OR EXISTS(SELECT 1 FROM opinion_cluster cl WHERE cl.case_id=c.id)
ON CONFLICT(case_id) DO NOTHING;
INSERT INTO document_citation_work(document_id)
SELECT document_id FROM document_content
ON CONFLICT(document_id) DO NOTHING;
COMMIT;
