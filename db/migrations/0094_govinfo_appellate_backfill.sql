BEGIN;

CREATE TABLE govinfo_appellate_checkpoint (
  court_code text PRIMARY KEY REFERENCES appellate_source_registry(court_code),
  offset_mark text NOT NULL DEFAULT '*',
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','failed','complete')),
  pages_processed bigint NOT NULL DEFAULT 0,
  records_discovered bigint NOT NULL DEFAULT 0,
  records_enqueued bigint NOT NULL DEFAULT 0,
  records_skipped bigint NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_successful_retrieval timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO govinfo_appellate_checkpoint (court_code)
SELECT court_code FROM appellate_source_registry
ON CONFLICT (court_code) DO NOTHING;

COMMIT;
