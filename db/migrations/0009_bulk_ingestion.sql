BEGIN;

ALTER TABLE court ADD COLUMN source_url text;

CREATE TABLE ingestion_checkpoint (
  provider_id uuid NOT NULL REFERENCES provider(id),
  stream_name text NOT NULL,
  cursor_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, stream_name)
);

COMMIT;
