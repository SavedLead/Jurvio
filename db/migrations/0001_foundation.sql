BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE ingestion_run_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE verification_state AS ENUM ('verified', 'stale', 'conflict', 'needs_review', 'not_verified');
CREATE TYPE publication_state AS ENUM ('draft', 'published', 'suppressed', 'restricted');

CREATE TABLE provider (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider(id),
  cursor_value text,
  status ingestion_run_status NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  records_seen integer NOT NULL DEFAULT 0,
  records_changed integer NOT NULL DEFAULT 0,
  error jsonb
);

CREATE TABLE raw_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider(id),
  ingestion_run_id uuid REFERENCES ingestion_run(id),
  source_uri text NOT NULL,
  source_record_id text,
  content_hash text NOT NULL,
  object_key text NOT NULL,
  media_type text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider_id, content_hash)
);

CREATE TABLE court (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  provider_id uuid REFERENCES provider(id),
  provider_court_id text,
  name text NOT NULL,
  short_name text,
  jurisdiction text,
  verification verification_state NOT NULL DEFAULT 'not_verified',
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (provider_id, provider_court_id)
);

CREATE TABLE legal_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  court_id uuid NOT NULL REFERENCES court(id),
  docket_number text NOT NULL,
  caption text NOT NULL,
  filed_on date,
  terminated_on date,
  nature_of_suit_code text,
  cause_of_action text,
  activity_state text NOT NULL DEFAULT 'active',
  procedural_phase text NOT NULL DEFAULT 'filing',
  disposition_scope text NOT NULL DEFAULT 'none',
  judgment_state text NOT NULL DEFAULT 'none',
  appeal_state text NOT NULL DEFAULT 'unavailable',
  verification verification_state NOT NULL DEFAULT 'not_verified',
  status_explanation text,
  status_rule_version text,
  status_event_id uuid,
  publication publication_state NOT NULL DEFAULT 'draft',
  source_artifact_id uuid REFERENCES raw_artifact(id),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (court_id, docket_number)
);

CREATE TABLE case_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES provider(id),
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  UNIQUE NULLS NOT DISTINCT (provider_id, identifier_type, identifier_value)
);

CREATE TABLE case_status_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  occurred_on date,
  docket_entry_number text,
  target_scope text NOT NULL DEFAULT 'case',
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  source_record_id text,
  rule_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (case_id, source_artifact_id, source_record_id, event_type)
);

ALTER TABLE legal_case
  ADD CONSTRAINT legal_case_status_event_fk
  FOREIGN KEY (status_event_id) REFERENCES case_status_event(id);

CREATE TABLE docket_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES provider(id),
  provider_entry_id text,
  entry_number text,
  filed_on date,
  description text NOT NULL,
  entry_type text,
  importance text NOT NULL DEFAULT 'routine',
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (provider_id, provider_entry_id)
);

CREATE TABLE entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  entity_type text NOT NULL CHECK (entity_type IN ('person', 'organization', 'agency', 'law_firm')),
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  identity_confidence numeric(4,3) CHECK (identity_confidence BETWEEN 0 AND 1),
  verification verification_state NOT NULL DEFAULT 'not_verified',
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE party_appearance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entity(id),
  role text NOT NULL,
  party_name_as_filed text NOT NULL,
  started_on date,
  ended_on date,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  UNIQUE NULLS NOT DISTINCT (case_id, entity_id, role, started_on)
);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  docket_entry_id uuid REFERENCES docket_entry(id),
  document_type text NOT NULL,
  title text NOT NULL,
  filed_on date,
  content_hash text,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  publication publication_state NOT NULL DEFAULT 'draft',
  extraction_confidence numeric(4,3) CHECK (extraction_confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publication_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  displayable boolean NOT NULL,
  indexable boolean NOT NULL,
  machine_accessible boolean NOT NULL,
  downloadable boolean NOT NULL,
  summary_eligible boolean NOT NULL,
  reason_code text NOT NULL,
  rule_version text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  review_after timestamptz
);

CREATE TABLE outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  UNIQUE (aggregate_type, aggregate_id, aggregate_version, topic)
);

CREATE INDEX legal_case_publication_updated_idx ON legal_case (publication, updated_at DESC);
CREATE INDEX docket_entry_case_filed_idx ON docket_entry (case_id, filed_on DESC, entry_number);
CREATE INDEX party_appearance_case_idx ON party_appearance (case_id);
CREATE INDEX entity_normalized_name_idx ON entity (normalized_name);
CREATE INDEX outbox_unpublished_idx ON outbox_event (created_at) WHERE published_at IS NULL;

INSERT INTO provider (code, name, base_url)
VALUES ('courtlistener', 'CourtListener / RECAP', 'https://www.courtlistener.com')
ON CONFLICT (code) DO NOTHING;

COMMIT;
