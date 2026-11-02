-- Official outcome sources for "Where this case stands" (case-stands v2,
-- phases 4 and 5). Two read-mostly side tables, filled by dispatch-only
-- backfills that run on the builder; nothing here publishes a case.
--
-- scotus_docket_status: what the Supreme Court's own docket page says about a
--   case we hold (cert granted / denied / dismissed, the judgment line and its
--   date, the party titles). Only the docket header and "Proceedings and
--   Orders" lines are kept; attorney contact blocks are never stored.
--
-- fjc_idb_case_outcome: how a federal district civil case ended according to
--   the Federal Judicial Center Integrated Database (disposition, judgment-for,
--   date terminated), matched to our case on (district, docket core, office,
--   filing year) with exactly one candidate.

CREATE TABLE IF NOT EXISTS scotus_docket_status (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  docket_number text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://www[.]supremecourt[.]gov/'),
  fetched_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  parser_version text NOT NULL,
  petitioner_title text,
  respondent_title text,
  lower_court text,
  lower_court_decided_on date,
  docketed_on date,
  cert_status text NOT NULL CHECK (cert_status IN ('granted', 'denied', 'dismissed', 'pending')),
  cert_status_on date,
  cert_entry text,
  judgment_on date,
  judgment_entry text,
  last_entry_on date,
  entry_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fjc_idb_case_outcome (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  idb_row_id text NOT NULL,
  date_terminated date,
  disposition_code smallint,
  judgment_code smallint,
  nature_of_judgment smallint,
  procedural_progress smallint,
  plaintiff text,
  defendant text,
  source_uri text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
