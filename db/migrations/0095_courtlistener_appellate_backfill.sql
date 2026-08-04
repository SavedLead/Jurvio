BEGIN;

CREATE TABLE courtlistener_appellate_checkpoint (
  court_code text NOT NULL REFERENCES appellate_source_registry(court_code),
  filing_year integer NOT NULL CHECK (filing_year BETWEEN 1700 AND 2200),
  next_cursor text,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'failed', 'complete')),
  pages_processed bigint NOT NULL DEFAULT 0,
  records_discovered bigint NOT NULL DEFAULT 0,
  records_completed bigint NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_successful_retrieval timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (court_code, filing_year)
);

CREATE TABLE courtlistener_appellate_backfill_item (
  cluster_id bigint PRIMARY KEY,
  court_code text NOT NULL REFERENCES appellate_source_registry(court_code),
  filing_year integer NOT NULL CHECK (filing_year BETWEEN 1700 AND 2200),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'processing', 'retry', 'complete', 'blocked')),
  attempts integer NOT NULL DEFAULT 0,
  case_public_id text,
  document_count integer NOT NULL DEFAULT 0,
  last_error text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (court_code, filing_year)
    REFERENCES courtlistener_appellate_checkpoint(court_code, filing_year)
);

CREATE INDEX courtlistener_appellate_backfill_queue_idx
  ON courtlistener_appellate_backfill_item (court_code, state, updated_at);

INSERT INTO courtlistener_appellate_checkpoint (court_code, filing_year)
SELECT court_code, EXTRACT(YEAR FROM now())::integer
FROM appellate_source_registry
ON CONFLICT (court_code, filing_year) DO NOTHING;

COMMIT;
