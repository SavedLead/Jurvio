BEGIN;

CREATE TYPE privacy_request_status AS ENUM (
  'submitted', 'identity_pending', 'in_review', 'approved', 'partially_approved',
  'rejected', 'withdrawn', 'closed'
);
CREATE TYPE privacy_verification_status AS ENUM ('not_started', 'pending', 'verified', 'failed', 'expired');
CREATE TYPE privacy_action_status AS ENUM ('proposed', 'approved', 'rejected', 'applied', 'reverted');

CREATE TABLE privacy_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  status privacy_request_status NOT NULL DEFAULT 'submitted',
  requester_type text NOT NULL CHECK (requester_type IN ('self', 'authorized_representative', 'organization')),
  contact_channel_ref text NOT NULL,
  contact_email_hash text NOT NULL,
  request_summary text NOT NULL,
  identity_status privacy_verification_status NOT NULL DEFAULT 'not_started',
  verification_provider text,
  verification_reference text,
  verification_completed_at timestamptz,
  assigned_to uuid REFERENCES internal_user(id),
  decision_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  closed_at timestamptz,
  CHECK (identity_status <> 'verified' OR (verification_provider IS NOT NULL AND verification_reference IS NOT NULL AND verification_completed_at IS NOT NULL))
);

COMMENT ON COLUMN privacy_request.verification_reference IS
  'Opaque reference to evidence held by the approved identity-verification provider. Raw ID and ID images must never be stored here.';

CREATE TABLE privacy_request_target (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privacy_request_id uuid NOT NULL REFERENCES privacy_request(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('entity', 'legal_case', 'document', 'url')),
  target_entity_id uuid REFERENCES entity(id),
  target_case_id uuid REFERENCES legal_case(id),
  target_document_id uuid REFERENCES document(id),
  target_url text,
  requested_remedy text NOT NULL CHECK (requested_remedy IN ('mask_name', 'noindex', 'canonical_redirect', 'suppress_display', 'correct_record')),
  requester_explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(target_entity_id, target_case_id, target_document_id, target_url) = 1)
);

CREATE TABLE privacy_abuse_signal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privacy_request_id uuid NOT NULL REFERENCES privacy_request(id) ON DELETE RESTRICT,
  signal_type text NOT NULL CHECK (signal_type IN ('network_velocity', 'email_velocity', 'target_velocity', 'duplicate_request', 'verification_mismatch', 'manual_flag')),
  severity text NOT NULL CHECK (severity IN ('low', 'moderate', 'high')),
  keyed_value_hash text,
  observed_count integer CHECK (observed_count IS NULL OR observed_count >= 0),
  window_seconds integer CHECK (window_seconds IS NULL OR window_seconds > 0),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE privacy_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privacy_request_target_id uuid NOT NULL REFERENCES privacy_request_target(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('entity_mask', 'noindex', 'canonical_redirect', 'publication_restriction', 'record_correction')),
  status privacy_action_status NOT NULL DEFAULT 'proposed',
  proposed_payload jsonb NOT NULL,
  proposed_by uuid NOT NULL REFERENCES internal_user(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES internal_user(id),
  approved_at timestamptz,
  applied_by uuid REFERENCES internal_user(id),
  applied_at timestamptz,
  reverted_by uuid REFERENCES internal_user(id),
  reverted_at timestamptz,
  CHECK (status NOT IN ('approved', 'applied', 'reverted') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status NOT IN ('applied', 'reverted') OR (applied_by IS NOT NULL AND applied_at IS NOT NULL)),
  CHECK (status <> 'reverted' OR (reverted_by IS NOT NULL AND reverted_at IS NOT NULL)),
  CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

CREATE TABLE entity_mask (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entity(id) ON DELETE RESTRICT,
  privacy_action_id uuid NOT NULL UNIQUE REFERENCES privacy_action(id) ON DELETE RESTRICT,
  replacement_display_name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  reverted_at timestamptz,
  CHECK (NOT active OR (activated_at IS NOT NULL AND reverted_at IS NULL))
);

CREATE UNIQUE INDEX entity_mask_one_active_idx ON entity_mask(entity_id) WHERE active;

CREATE TABLE privacy_url_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privacy_action_id uuid NOT NULL UNIQUE REFERENCES privacy_action(id) ON DELETE RESTRICT,
  source_path text NOT NULL,
  canonical_path text,
  directive text NOT NULL CHECK (directive IN ('noindex', 'redirect_301')),
  active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  reverted_at timestamptz,
  CHECK (directive <> 'redirect_301' OR canonical_path IS NOT NULL),
  CHECK (canonical_path IS NULL OR canonical_path <> source_path),
  CHECK (NOT active OR (activated_at IS NOT NULL AND reverted_at IS NULL))
);

CREATE UNIQUE INDEX privacy_url_rule_one_active_path_idx ON privacy_url_rule(source_path) WHERE active;

CREATE TABLE privacy_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privacy_request_id uuid NOT NULL REFERENCES privacy_request(id) ON DELETE RESTRICT,
  actor_internal_user_id uuid REFERENCES internal_user(id),
  event_type text NOT NULL,
  prior_state jsonb,
  new_state jsonb,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX privacy_request_queue_idx ON privacy_request(status, submitted_at);
CREATE INDEX privacy_abuse_request_idx ON privacy_abuse_signal(privacy_request_id, created_at DESC);
CREATE INDEX privacy_audit_request_idx ON privacy_audit_event(privacy_request_id, occurred_at DESC);

COMMIT;
