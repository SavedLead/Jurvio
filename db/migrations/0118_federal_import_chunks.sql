-- Resumable chunked federal opinion import.
--
-- The 51 GB CourtListener opinions bulk file is streamed ONCE and split into many
-- smaller JSONL chunk files on disk (the "extract" step). Each chunk is then
-- imported independently (the "import" step). This table is the resume ledger: it
-- records every chunk produced, whether it has been validated, and whether its
-- opinions have been imported -- so a failure retries only unfinished chunks and
-- never re-extracts the whole file or re-imports completed chunks.
--
-- status transitions: 'ready' (extracted + validated) -> 'importing' -> 'completed'
--                     (or 'failed', which is retried like 'ready').
CREATE TABLE IF NOT EXISTS federal_import_chunk (
  -- The snapshot the chunk came from plus its zero-padded index, e.g.
  -- '2026-09-30/000123'. Unique so re-extraction is idempotent.
  chunk_key           text PRIMARY KEY,
  snapshot_date       date NOT NULL,
  chunk_index         integer NOT NULL,
  -- Absolute path of the chunk file on the ingestion box (JSONL, bz2-compressed).
  file_path           text NOT NULL,
  -- Number of opinion records the extractor wrote into the chunk (validation anchor).
  record_count        integer NOT NULL,
  -- sha256 of the compressed chunk file, so a resumed import can detect a chunk that
  -- was truncated by an interrupted extraction and re-extract just that one.
  file_sha256         text,
  status              text NOT NULL DEFAULT 'ready'
                        CHECK (status IN ('ready', 'importing', 'completed', 'failed')),
  -- Opinions actually written by the importer for this chunk (may be < record_count:
  -- non-federal opinions are skipped, and already-present ones upsert).
  opinions_written    integer NOT NULL DEFAULT 0,
  opinions_skipped    integer NOT NULL DEFAULT 0,
  last_error          text,
  extracted_at        timestamptz NOT NULL DEFAULT now(),
  import_started_at   timestamptz,
  import_finished_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, chunk_index)
);

-- The importer's worklist: the next unfinished chunk for a snapshot, oldest first.
CREATE INDEX IF NOT EXISTS federal_import_chunk_worklist_idx
  ON federal_import_chunk (snapshot_date, chunk_index)
  WHERE status IN ('ready', 'failed');
