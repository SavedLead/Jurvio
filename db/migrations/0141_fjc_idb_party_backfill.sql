BEGIN;

-- Federal Judicial Center Integrated Database, redistributed by CourtListener as
-- bulk-data/fjc-integrated-database-YYYY-MM-DD.csv.bz2. It is the only free bulk
-- source that carries explicit party names WITH official roles: every civil row
-- has a `plaintiff` and a `defendant` column populated by the FJC itself. The
-- CourtListener bulk export contains no party or attorney table at all, so
-- without this source the only party data we can ever get is the per-docket
-- CourtListener REST path, which cannot backfill a historical corpus.
INSERT INTO provider (code, name, base_url)
VALUES (
  'fjc_idb',
  'Federal Judicial Center Integrated Database',
  'https://www.fjc.gov/research/idb'
)
ON CONFLICT (code) DO NOTHING;

-- The IDB identifies a case by (district, office, 7-character docket "core"),
-- where the core is a 2-digit filing year followed by a 5-digit sequence:
-- "8907217" is the 7,217th case filed in 1989. Our legal_case.docket_number
-- holds the full PACER form ("2:89-cv-07217"), so matching an IDB row to a case
-- requires deriving the same core from our side. Doing that derivation in an
-- IMMUTABLE function lets it be indexed, which turns the backfill's per-case
-- lookup from a sequential scan into an index probe.
--
-- The two-digit year is century-ambiguous in the IDB itself. That ambiguity
-- cancels out here because both sides derive the core the same way from the same
-- two digits; the importer additionally requires the case's filed_on year to
-- agree with the IDB row's date_filed year before it writes anything.
CREATE OR REPLACE FUNCTION federal_docket_core(docket_number text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  parts text[];
BEGIN
  parts := regexp_match(
    lower(btrim(docket_number)),
    '^(?:[0-9]+:)?([0-9]{2})-[a-z]{2,5}-([0-9]{1,5})(?:[^0-9].*)?$'
  );
  IF parts IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN parts[1] || lpad(parts[2], 5, '0');
END;
$$;

-- Same shape, for the office number that precedes the colon ("2" in
-- "2:89-cv-07217"). The IDB carries office separately, and two cases in one
-- district can share a core across offices, so the importer compares it.
CREATE OR REPLACE FUNCTION federal_docket_office(docket_number text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  parts text[];
BEGIN
  parts := regexp_match(lower(btrim(docket_number)), '^([0-9]+):');
  IF parts IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN parts[1];
END;
$$;

-- Resumable per-file progress for the backfill. The IDB export is a single
-- ~280MB compressed CSV of several million rows; a run that dies partway
-- through must not restart from row zero.
CREATE TABLE IF NOT EXISTS fjc_idb_import_checkpoint (
  snapshot_date date NOT NULL,
  filing_year integer NOT NULL,
  rows_read bigint NOT NULL DEFAULT 0,
  rows_matched bigint NOT NULL DEFAULT 0,
  appearances_written bigint NOT NULL DEFAULT 0,
  last_row_id text,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, filing_year)
);

COMMIT;

-- legal_case holds millions of bulk-loaded rows now, so the expression index is
-- built CONCURRENTLY in its own committed chunk (no write lock on legal_case).
-- (Renumbered from 0114, which 0114_case_citation_graph.sql took.)

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_case_federal_docket_core_idx
  ON legal_case (court_id, federal_docket_core(docket_number))
  WHERE federal_docket_core(docket_number) IS NOT NULL;

-- @commit

ANALYZE legal_case;
