BEGIN;

CREATE TABLE ingestion_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL,
  run_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_count integer NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE TABLE ingestion_run_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id) ON DELETE CASCADE,
  source_record_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  case_public_id text,
  document_count integer CHECK (document_count IS NULL OR document_count >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (ingestion_run_id, source_record_id)
);

CREATE INDEX ingestion_run_recent_idx ON ingestion_run (started_at DESC);
CREATE INDEX ingestion_run_item_status_idx ON ingestion_run_item (ingestion_run_id, status);

COMMIT;
