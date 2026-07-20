BEGIN;

CREATE TYPE agent_risk_tier AS ENUM ('low', 'moderate', 'high', 'restricted');
CREATE TYPE agent_task_status AS ENUM (
  'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'dead_letter'
);
CREATE TYPE publication_review_status AS ENUM (
  'pending', 'in_review', 'approved', 'rejected', 'needs_changes', 'cancelled'
);

CREATE TABLE agent_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL,
  risk_tier agent_risk_tier NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  capability_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_runtime_seconds integer NOT NULL CHECK (max_runtime_seconds > 0),
  max_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (max_cost_microusd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (code, version)
);

CREATE TABLE agent_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition(id),
  task_type text NOT NULL,
  idempotency_key text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status agent_task_status NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error jsonb,
  UNIQUE (agent_definition_id, idempotency_key)
);

CREATE INDEX agent_task_queue_idx
  ON agent_task (priority DESC, available_at, created_at)
  WHERE status = 'queued';

CREATE TABLE agent_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_task_id uuid NOT NULL REFERENCES agent_task(id),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition(id),
  status agent_task_status NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  model_provider text,
  model_name text,
  prompt_version text,
  input_hash text NOT NULL,
  output jsonb,
  tokens_in bigint,
  tokens_out bigint,
  cost_microusd bigint NOT NULL DEFAULT 0 CHECK (cost_microusd >= 0),
  trace_id text,
  error jsonb
);

CREATE TABLE agent_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid NOT NULL REFERENCES agent_run(id),
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  proposed_payload jsonb NOT NULL,
  approval_required boolean NOT NULL DEFAULT true,
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (executed_at IS NULL OR approval_required = false OR approved_at IS NOT NULL)
);

CREATE TABLE publication_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  status publication_review_status NOT NULL DEFAULT 'pending',
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('system', 'agent', 'user')),
  requested_by_id uuid,
  preflight_version text NOT NULL,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewer_id uuid,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE UNIQUE INDEX publication_review_active_target_idx
  ON publication_review (object_type, object_id)
  WHERE status IN ('pending', 'in_review', 'needs_changes');

CREATE INDEX publication_review_queue_idx
  ON publication_review (created_at)
  WHERE status IN ('pending', 'needs_changes');

INSERT INTO agent_definition (
  code, version, name, purpose, risk_tier, enabled,
  capability_manifest, max_runtime_seconds, max_cost_microusd
) VALUES
  ('publication-review-assistant', '1.0.0', 'Publication Review Assistant',
   'Prepare source-linked publication preflight recommendations without publishing.',
   'high', false, '["read_canonical","propose_publication_review"]'::jsonb, 300, 0),
  ('demand-prioritizer', '1.0.0', 'Demand Prioritizer',
   'Rank enrichment candidates from separated human and machine demand signals.',
   'moderate', false, '["read_demand_events","propose_enrichment_priority"]'::jsonb, 300, 0)
ON CONFLICT (code, version) DO NOTHING;

COMMIT;
