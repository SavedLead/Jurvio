BEGIN;

CREATE TABLE entity_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES provider(id),
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (provider_id, identifier_type, identifier_value)
);

CREATE INDEX entity_identifier_entity_idx ON entity_identifier (entity_id);

COMMIT;
