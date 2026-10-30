-- Unlogged staging for CourtListener bulk docket loads. A chunk is copied here,
-- merged, then truncated. Unlogged so a 5,000-row chunk does not flood the WAL.
-- A crash empties the table; the ingestion_checkpoint row is logged and is the resume point.

CREATE UNLOGGED TABLE IF NOT EXISTS courtlistener_docket_stage (
  docket_id text NOT NULL,
  court_code text NOT NULL,
  docket_number text NOT NULL,
  normalized_docket text NOT NULL,
  caption text NOT NULL,
  filed_on date,
  terminated_on date,
  nature_of_suit text,
  cause text,
  date_modified timestamptz,
  public_id text NOT NULL,
  publication text NOT NULL
);
