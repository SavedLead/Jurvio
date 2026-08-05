BEGIN;

CREATE TABLE case_intelligence_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('deterministic', 'model_bakeoff', 'ai_fallback')),
  rule_version text NOT NULL,
  model_provider text,
  model_name text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'budget_stopped')),
  cases_seen integer NOT NULL DEFAULT 0,
  cases_changed integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  budget_usd numeric(12,6),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error jsonb
);

CREATE TABLE case_intelligence_fact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  subject_type text,
  subject_id uuid,
  value jsonb NOT NULL,
  occurred_on date,
  effective_until date,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  docket_entry_id uuid REFERENCES docket_entry(id),
  document_id uuid REFERENCES document(id),
  extraction_method text NOT NULL CHECK (extraction_method IN ('source_field', 'deterministic_rule', 'model', 'human')),
  extractor_version text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  fingerprint text NOT NULL,
  supersedes_fact_id uuid REFERENCES case_intelligence_fact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, fingerprint)
);

CREATE TABLE case_intelligence_answer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  answer_key text NOT NULL CHECK (answer_key IN ('what_happened', 'case_about', 'current_status', 'why_it_matters', 'ruling_outcome', 'latest_update')),
  answer_text text NOT NULL,
  answer_state text NOT NULL CHECK (answer_state IN ('verified', 'awaiting_deadline', 'court_update_unknown', 'insufficient_evidence', 'needs_review')),
  generation_method text NOT NULL CHECK (generation_method IN ('deterministic', 'model', 'human')),
  rule_version text NOT NULL,
  model_run_id uuid REFERENCES case_intelligence_run(id),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_fact_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_hash text NOT NULL,
  as_of date NOT NULL,
  refresh_on date,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX case_intelligence_answer_current_idx
  ON case_intelligence_answer (case_id, answer_key) WHERE is_current;
CREATE INDEX case_intelligence_answer_refresh_idx
  ON case_intelligence_answer (refresh_on) WHERE is_current AND refresh_on IS NOT NULL;
CREATE INDEX case_intelligence_fact_case_type_idx
  ON case_intelligence_fact (case_id, fact_type, occurred_on DESC);

CREATE TABLE case_intelligence_evaluation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  answer_key text NOT NULL,
  candidate_run_id uuid NOT NULL REFERENCES case_intelligence_run(id) ON DELETE CASCADE,
  candidate_answer text NOT NULL,
  groundedness numeric(4,3),
  legal_accuracy numeric(4,3),
  completeness numeric(4,3),
  clarity numeric(4,3),
  citation_fidelity numeric(4,3),
  json_valid boolean,
  latency_ms integer,
  cost_usd numeric(12,8),
  evaluator_version text NOT NULL,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
