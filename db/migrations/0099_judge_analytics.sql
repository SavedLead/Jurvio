BEGIN;

CREATE TABLE judge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  court_id uuid REFERENCES court(id),
  active boolean,
  verification verification_state NOT NULL DEFAULT 'not_verified',
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (court_id, normalized_name)
);

CREATE TABLE judge_case_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  assignment_role text NOT NULL DEFAULT 'presiding',
  started_on date,
  ended_on date,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  extraction_method text NOT NULL CHECK (extraction_method IN ('source_field', 'deterministic_rule', 'human')),
  extractor_version text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (judge_id, case_id, assignment_role, started_on)
);

CREATE TABLE judge_case_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  observation_type text NOT NULL CHECK (observation_type IN (
    'case_outcome', 'motion_outcome', 'monetary_request', 'monetary_award', 'major_ruling'
  )),
  nature_of_suit_code text,
  motion_type text,
  favored_side text CHECK (favored_side IN ('plaintiff', 'defendant', 'mixed', 'neither', 'unknown')),
  disposition text,
  amount_usd numeric(18,2) CHECK (amount_usd IS NULL OR amount_usd >= 0),
  occurred_on date,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  docket_entry_id uuid REFERENCES docket_entry(id),
  document_id uuid REFERENCES document(id),
  extraction_method text NOT NULL CHECK (extraction_method IN ('source_field', 'deterministic_rule', 'human')),
  extractor_version text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (judge_id, case_id, fingerprint)
);

CREATE INDEX judge_normalized_name_idx ON judge (normalized_name);
CREATE INDEX judge_assignment_case_idx ON judge_case_assignment (case_id);
CREATE INDEX judge_assignment_judge_idx ON judge_case_assignment (judge_id);
CREATE INDEX judge_observation_judge_type_idx
  ON judge_case_observation (judge_id, observation_type, occurred_on DESC);
CREATE INDEX judge_observation_nos_idx
  ON judge_case_observation (judge_id, nature_of_suit_code, observation_type);

COMMIT;
