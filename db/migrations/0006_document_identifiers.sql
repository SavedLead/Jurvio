BEGIN;

CREATE TABLE document_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES provider(id),
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (provider_id, identifier_type, identifier_value)
);

CREATE INDEX document_identifier_document_idx ON document_identifier (document_id);

COMMIT;
