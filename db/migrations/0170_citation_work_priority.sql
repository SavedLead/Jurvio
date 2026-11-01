-- Citation lane throughput (citation web plan, PR A1).
--
-- Both citation work queues were strict FIFO: a new opinion waited behind the
-- whole backfill (689,146 documents and 1,008,226 case identities on
-- 2026-11-01, about 36 days at one 200-row batch per 15 minutes). A priority
-- column lets live work jump the queue:
--   10  new or changed content / identities (the triggers below)
--    0  backfill (every row already queued, and bulk requeues)
-- The resident worker drains priority work first; builder-run backfill drains
-- the rest. Adding a NOT NULL column with a constant default does not rewrite
-- the table in PostgreSQL 11+.
ALTER TABLE document_citation_work ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0;
ALTER TABLE case_citation_work ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION queue_document_case_citations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO document_citation_work(document_id, priority) VALUES (NEW.document_id, 10)
  ON CONFLICT(document_id) DO UPDATE SET queued_at=clock_timestamp(),
    priority=GREATEST(document_citation_work.priority, EXCLUDED.priority);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION queue_case_citation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='legal_case' THEN
    IF TG_OP='INSERT' AND NEW.official_citation IS NULL THEN RETURN NEW; END IF;
    INSERT INTO case_citation_work(case_id, priority) VALUES (NEW.id, 10)
    ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp(), priority=GREATEST(case_citation_work.priority, EXCLUDED.priority);
  ELSE
    INSERT INTO case_citation_work(case_id, priority) VALUES (NEW.case_id, 10)
    ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp(), priority=GREATEST(case_citation_work.priority, EXCLUDED.priority);
    IF TG_OP='UPDATE' AND OLD.case_id IS DISTINCT FROM NEW.case_id THEN
      INSERT INTO case_citation_work(case_id, priority) VALUES (OLD.case_id, 10)
      ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp(), priority=GREATEST(case_citation_work.priority, EXCLUDED.priority);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION queue_deleted_cluster_citations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO case_citation_work(case_id, priority) SELECT id, 10 FROM legal_case WHERE id=OLD.case_id
  ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp(), priority=GREATEST(case_citation_work.priority, EXCLUDED.priority);
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION queue_verified_citation_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'DELETE' THEN
    INSERT INTO case_citation_work(case_id, priority) SELECT id, 10 FROM legal_case WHERE id=NEW.case_id
    ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp(), priority=GREATEST(case_citation_work.priority, EXCLUDED.priority);
  END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.case_id IS DISTINCT FROM NEW.case_id) THEN
    INSERT INTO case_citation_work(case_id, priority) SELECT id, 10 FROM legal_case WHERE id=OLD.case_id
    ON CONFLICT(case_id) DO UPDATE SET queued_at=clock_timestamp(), priority=GREATEST(case_citation_work.priority, EXCLUDED.priority);
  END IF;
  RETURN NULL;
END $$;

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS document_citation_work_priority_idx
  ON document_citation_work (priority DESC, queued_at, document_id);

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS case_citation_work_priority_idx
  ON case_citation_work (priority DESC, queued_at, case_id);
