BEGIN;

CREATE TABLE attorney (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  verification verification_state NOT NULL DEFAULT 'not_verified',
  authoritative_source_url text,
  authoritative_source_kind text CHECK (authoritative_source_kind IS NULL OR authoritative_source_kind IN ('court_record', 'bar_directory', 'government_directory')),
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verification <> 'verified' OR authoritative_source_url IS NOT NULL)
);

CREATE TABLE attorney_case_appearance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_id uuid NOT NULL REFERENCES attorney(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  law_firm_entity_id uuid REFERENCES entity(id),
  role text NOT NULL,
  name_as_filed text NOT NULL,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (attorney_id, case_id, role, law_firm_entity_id),
  CHECK (source_artifact_id IS NOT NULL OR source_url IS NOT NULL)
);

CREATE TABLE attorney_firm_affiliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_id uuid NOT NULL REFERENCES attorney(id) ON DELETE CASCADE,
  firm_entity_id uuid NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  title text,
  started_on date,
  ended_on date,
  source_url text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('bar_directory', 'firm_website', 'government_directory', 'court_record')),
  verified_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (attorney_id, firm_entity_id, started_on, ended_on)
);

CREATE TABLE professional_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_id uuid REFERENCES attorney(id) ON DELETE CASCADE,
  firm_entity_id uuid REFERENCES entity(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('email', 'phone', 'website', 'office_address')),
  display_value text NOT NULL,
  href text,
  source_url text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('bar_directory', 'firm_website', 'government_directory')),
  verified_on date NOT NULL,
  displayable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((attorney_id IS NOT NULL)::int + (firm_entity_id IS NOT NULL)::int = 1),
  UNIQUE NULLS NOT DISTINCT (attorney_id, firm_entity_id, contact_type, display_value)
);

CREATE INDEX attorney_name_idx ON attorney (normalized_name, public_id);
CREATE INDEX attorney_case_case_idx ON attorney_case_appearance (case_id, attorney_id);
CREATE INDEX attorney_case_attorney_idx ON attorney_case_appearance (attorney_id, case_id);
CREATE INDEX attorney_firm_firm_idx ON attorney_firm_affiliation (firm_entity_id, attorney_id);
CREATE INDEX professional_contact_attorney_idx ON professional_contact (attorney_id) WHERE displayable;
CREATE INDEX professional_contact_firm_idx ON professional_contact (firm_entity_id) WHERE displayable;

COMMIT;

