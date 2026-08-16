-- Make the CourtListener bulk appellate loader resumable and box-survivable.
--
-- The first-generation loader built the entire COA docket set in memory by
-- streaming the full multi-GB dockets export on every run, then held the matched
-- clusters in memory for Passes B/C. On the CPU-bound box that single unresumable
-- Pass A did not finish inside the 350-minute CI cap (it timed out with zero
-- opinions written), and a killed run lost all progress. These two tables let the
-- loader (a) persist the COA docket index once and reuse it, and (b) checkpoint a
-- per-file row cursor so a run that hits its soft time budget exits cleanly and a
-- re-dispatch resumes instead of restarting.
--
-- cl_bulk_coa_docket: the durable COA docket index. One row per (snapshot, docket)
-- for the 13 Courts of Appeals only, carrying the minimal join facts Pass B needs
-- plus memoised internal ids so a docket with many clusters resolves its case/court
-- exactly once. Replaces the in-memory Map, so Pass B/C no longer rebuild it and
-- survive a restart.
--
-- cl_bulk_ingest_progress: a per-(snapshot, stage) cursor. rows_scanned is the
-- number of source rows the loader has already consumed for that file; on resume it
-- fast-skips that many rows (decompress-and-discard, no parse/DB) and continues.
-- done flips true when the file is fully consumed, so a completed stage is never
-- re-streamed. Nullable-free, tiny, and idempotent to (re)create.

CREATE TABLE IF NOT EXISTS cl_bulk_coa_docket (
  snapshot_date date NOT NULL,
  docket_id text NOT NULL,
  court_code text NOT NULL,
  docket_number text NOT NULL,
  case_name text NOT NULL,
  date_filed date,
  case_internal_id text,
  court_internal_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, docket_id)
);

CREATE TABLE IF NOT EXISTS cl_bulk_ingest_progress (
  snapshot_date date NOT NULL,
  stage text NOT NULL,
  rows_scanned bigint NOT NULL DEFAULT 0,
  rows_matched bigint NOT NULL DEFAULT 0,
  opinions_written bigint NOT NULL DEFAULT 0,
  opinions_skipped bigint NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, stage)
);
