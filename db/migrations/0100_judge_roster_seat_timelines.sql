BEGIN;

ALTER TABLE judge
  ADD COLUMN IF NOT EXISTS fjc_nid text,
  ADD COLUMN IF NOT EXISTS judge_type text,
  ADD COLUMN IF NOT EXISTS official_profile_url text,
  ADD COLUMN IF NOT EXISTS biography text,
  ADD COLUMN IF NOT EXISTS biography_source_url text;

CREATE UNIQUE INDEX IF NOT EXISTS judge_fjc_nid_uidx
  ON judge (fjc_nid) WHERE fjc_nid IS NOT NULL;

CREATE TABLE judicial_seat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id uuid NOT NULL REFERENCES court(id),
  source_system text NOT NULL,
  source_seat_key text NOT NULL,
  seat_number integer,
  authorized_on date,
  abolished_on date,
  source_url text NOT NULL,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_seat_key)
);

CREATE TABLE judge_service_term (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES court(id),
  judicial_seat_id uuid REFERENCES judicial_seat(id),
  service_type text NOT NULL CHECK (service_type IN (
    'article_iii_active', 'article_iii_senior', 'chief', 'magistrate',
    'bankruptcy', 'territorial', 'federal_claims', 'visiting', 'recalled', 'other'
  )),
  started_on date,
  ended_on date,
  succession_order integer,
  commission_date date,
  termination_reason text,
  source_system text NOT NULL,
  source_record_key text NOT NULL,
  source_url text NOT NULL,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  verification verification_state NOT NULL DEFAULT 'not_verified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
  UNIQUE (source_system, source_record_key)
);

CREATE TABLE judge_name_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  display_value text NOT NULL,
  normalized_value text NOT NULL,
  variant_type text NOT NULL CHECK (variant_type IN (
    'official', 'former', 'initials', 'abbreviation', 'suffix', 'source_observed'
  )),
  valid_from date,
  valid_to date,
  source_url text,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (judge_id, normalized_value, variant_type, valid_from)
);

CREATE TABLE judge_profile_fact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES judge(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  value_json jsonb NOT NULL,
  source_system text NOT NULL,
  source_url text NOT NULL,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  valid_from date,
  valid_to date,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (judge_id, fact_type, source_system, source_url, valid_from)
);

CREATE TABLE judge_match_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  judge_id uuid REFERENCES judge(id) ON DELETE CASCADE,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  observed_name text NOT NULL,
  observed_normalized_name text NOT NULL,
  relevant_on date,
  court_id uuid REFERENCES court(id),
  score numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('accepted', 'rejected', 'needs_review', 'unmatched')),
  matcher_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (
    case_id, judge_id, source_artifact_id, observed_normalized_name, matcher_version
  )
);

CREATE INDEX judicial_seat_court_idx ON judicial_seat (court_id, seat_number);
CREATE INDEX judge_service_eligibility_idx
  ON judge_service_term (court_id, started_on, ended_on, service_type);
CREATE INDEX judge_service_judge_idx ON judge_service_term (judge_id, started_on);
CREATE INDEX judge_name_variant_lookup_idx ON judge_name_variant (normalized_value);
CREATE INDEX judge_match_candidate_queue_idx
  ON judge_match_candidate (status, score DESC, created_at);

COMMIT;
