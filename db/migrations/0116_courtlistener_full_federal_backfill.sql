-- Full federal CourtListener backfill (ADR 0075): every federal court, every year,
-- bankruptcy included, loaded in set-based batches from a mirrored snapshot.
--
-- 1. Stage progress. cl_bulk_ingest_progress (0111) already holds one resumable
--    row cursor per (snapshot, stage); the batched loader commits it in the same
--    transaction as each batch, so a crash or deploy resumes at the last committed
--    batch. These columns record writes and wall-clock bounds per stage.
ALTER TABLE cl_bulk_ingest_progress
  ADD COLUMN IF NOT EXISTS rows_written bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

-- 2. Citation staging. Reporter citations arrive in their own file, unordered by
--    cluster. Instead of holding millions of them in memory until the file ends,
--    they are staged here (only for loaded clusters) and folded onto
--    opinion_cluster.citations in set-based chunks. Rows for a snapshot are
--    deleted once applied.
CREATE TABLE IF NOT EXISTS cl_bulk_citation_stage (
  snapshot_date date NOT NULL,
  citation_id bigint NOT NULL,
  cluster_id bigint NOT NULL,
  volume text NOT NULL,
  reporter text NOT NULL,
  page text NOT NULL,
  citation_type text NOT NULL,
  PRIMARY KEY (snapshot_date, citation_id)
);
CREATE INDEX IF NOT EXISTS cl_bulk_citation_stage_cluster_idx
  ON cl_bulk_citation_stage (snapshot_date, cluster_id);

-- 3. Docket-number reconciliation. A CourtListener docket that is not yet linked
--    by identifier is matched to an existing case in the same court whose docket
--    number is equal after dropping punctuation and case ("1:20-cv-00123" vs
--    "1:20cv00123"). The first-generation loader ran that comparison as a
--    sequential scan per docket; this index makes it a lookup.
CREATE INDEX IF NOT EXISTS legal_case_court_docket_normalized_idx
  ON legal_case (court_id, lower(regexp_replace(docket_number, '[^a-zA-Z0-9]', '', 'g')));

-- 4. Publication checks look up reviews by object id ("is anything blocking this
--    case or document?"). Only a partial index on active reviews existed, so the
--    check was a scan; it must stay a lookup once the corpus is millions of rows.
CREATE INDEX IF NOT EXISTS publication_review_object_idx
  ON publication_review (object_id);
