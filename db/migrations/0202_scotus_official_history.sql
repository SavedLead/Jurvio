-- Checkpoint and link tables for the 2017-now supremecourt.gov backfill.
-- These rows are not alert inputs. Subscriber matching reads docket_entry.created_at
-- and requires a displayable publication decision, which this load does not write.

CREATE TABLE IF NOT EXISTS scotus_official_checkpoint (
  lane text PRIMARY KEY,
  cursor jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scotus_counsel (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('petitioner', 'respondent', 'other')),
  name text NOT NULL,
  firm text,
  counsel_of_record boolean NOT NULL DEFAULT false,
  PRIMARY KEY (case_id, side, name)
);

CREATE TABLE IF NOT EXISTS scotus_filing_link (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  description text,
  filed_on date,
  content_sha256 text,
  PRIMARY KEY (case_id, source_url)
);

CREATE TABLE IF NOT EXISTS scotus_slip_index (
  source_record_id text PRIMARY KEY,
  term_year text NOT NULL,
  docket_number text NOT NULL,
  case_name text NOT NULL,
  filed_on date NOT NULL,
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS scotus_slip_index_term_idx ON scotus_slip_index (term_year, filed_on DESC);
