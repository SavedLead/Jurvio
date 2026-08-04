BEGIN;

CREATE TABLE judge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  verification verification_state NOT NULL DEFAULT 'not_verified',
  authoritative_source_url text,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verification <> 'verified' OR authoritative_source_url IS NOT NULL)
);

CREATE TABLE judicial_appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES court(id),
  position_title text NOT NULL,
  appointment_type text NOT NULL CHECK (appointment_type IN ('presidential', 'court', 'legislative', 'elected', 'appointed_other', 'unknown')),
  appointed_by_name text,
  appointed_by_office text,
  service_started_on date,
  service_ended_on date,
  source_url text NOT NULL,
  verified_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (judge_id, court_id, position_title, service_started_on)
);

CREATE TABLE judge_case_relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('assigned', 'presiding', 'opinion_author', 'panel_member')),
  name_as_filed text,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (judge_id, case_id, relationship_type),
  CHECK (source_artifact_id IS NOT NULL OR source_url IS NOT NULL)
);

CREATE TABLE court_profile_detail (
  court_id uuid PRIMARY KEY REFERENCES court(id) ON DELETE CASCADE,
  court_level text NOT NULL CHECK (court_level IN ('supreme', 'appellate', 'district', 'bankruptcy', 'magistrate', 'special', 'state', 'local', 'international', 'other')),
  role_summary text NOT NULL,
  jurisdiction_summary text NOT NULL,
  geographic_scope text,
  official_source_url text NOT NULL,
  verified_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX judge_name_idx ON judge (normalized_name, public_id);
CREATE INDEX judicial_appointment_judge_idx ON judicial_appointment (judge_id, service_ended_on);
CREATE INDEX judicial_appointment_court_idx ON judicial_appointment (court_id, service_ended_on);
CREATE INDEX judge_case_judge_idx ON judge_case_relationship (judge_id, case_id);
CREATE INDEX judge_case_case_idx ON judge_case_relationship (case_id, judge_id);

COMMIT;

