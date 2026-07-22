BEGIN;

ALTER TABLE entity DROP CONSTRAINT entity_entity_type_check;
ALTER TABLE entity
  ADD CONSTRAINT entity_entity_type_check
  CHECK (entity_type IN ('unknown', 'person', 'organization', 'agency', 'law_firm'));

CREATE TABLE ingestion_rejection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider(id),
  source_uri text NOT NULL,
  source_record_id text,
  reason_code text NOT NULL,
  error_message text NOT NULL,
  raw_artifact_id uuid REFERENCES raw_artifact(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (
    provider_id, source_uri, source_record_id, reason_code, resolved_at
  )
);

CREATE INDEX ingestion_rejection_open_idx
  ON ingestion_rejection (last_seen_at DESC)
  WHERE resolved_at IS NULL;

COMMIT;
