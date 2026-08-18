BEGIN;

-- U.S. Attorney's Offices are institution-level government litigants.  A case
-- is linked only when the public case party data identifies the United States
-- as the filing-side party in that office's district.  Individual attorney
-- attribution is deliberately separate and requires a signed filing or
-- docket appearance.
CREATE TABLE usao_office (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  office_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  district_court_id uuid REFERENCES court(id),
  doj_profile_url text NOT NULL,
  verification verification_state NOT NULL DEFAULT 'verified',
  source_url text NOT NULL,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usao_case_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES usao_office(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN (
    'filed_or_prosecuted', 'represented_united_states', 'government_defense'
  )),
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'party_role_and_district', 'signed_filing', 'docket_appearance', 'human'
  )),
  source_artifact_id uuid REFERENCES raw_artifact(id),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  matcher_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (office_id, case_id, relationship)
);

CREATE TABLE usao_attorney (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  office_id uuid NOT NULL REFERENCES usao_office(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  title text,
  division text,
  biography text,
  official_profile_url text,
  photo_url text,
  photo_source_url text,
  active boolean,
  verification verification_state NOT NULL DEFAULT 'not_verified',
  source_artifact_id uuid REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (office_id, normalized_name)
);

CREATE TABLE usao_attorney_case_appearance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_id uuid NOT NULL REFERENCES usao_attorney(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  appearance_role text NOT NULL CHECK (appearance_role IN (
    'counsel_of_record', 'signatory', 'docket_appearance', 'press_release_credit'
  )),
  observed_on date,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  extraction_method text NOT NULL CHECK (extraction_method IN (
    'source_field', 'deterministic_rule', 'human'
  )),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (attorney_id, case_id, appearance_role, observed_on, source_artifact_id)
);

CREATE INDEX usao_office_district_idx ON usao_office (district_court_id);
CREATE INDEX usao_case_assignment_case_idx ON usao_case_assignment (case_id);
CREATE INDEX usao_case_assignment_office_idx ON usao_case_assignment (office_id, created_at DESC);
CREATE INDEX usao_attorney_office_idx ON usao_attorney (office_id, active, display_name);
CREATE INDEX usao_attorney_case_case_idx ON usao_attorney_case_appearance (case_id);

-- The court-source registry already carries all 94 federal districts.  Guam and
-- the Northern Mariana Islands are intentionally one DOJ office, yielding the
-- correct nationwide total of 93 USAOs.
INSERT INTO usao_office (
  public_id, office_code, display_name, district_court_id, doj_profile_url,
  verification, source_url
)
SELECT
  'usao_' || CASE
    WHEN registry.jurvio_court_code IN ('gud', 'nmid') THEN 'guam-nmi'
    ELSE registry.jurvio_court_code
  END,
  CASE
    WHEN registry.jurvio_court_code IN ('gud', 'nmid') THEN 'guam-nmi'
    ELSE registry.jurvio_court_code
  END,
  CASE
    WHEN registry.jurvio_court_code IN ('gud', 'nmid')
      THEN 'U.S. Attorney''s Office for Guam and the Northern Mariana Islands'
    ELSE 'U.S. Attorney''s Office for ' || registry.court_name
  END,
  court.id,
  'https://www.justice.gov/usao',
  'verified',
  'https://www.justice.gov/usao'
FROM direct_court_registry registry
JOIN court ON court.provider_court_id = registry.jurvio_court_code
WHERE registry.court_type = 'district'
  AND registry.jurvio_court_code <> 'nmid'
ON CONFLICT (office_code) DO UPDATE
SET district_court_id = EXCLUDED.district_court_id,
    updated_at = now();

-- Historical and continuous office-level attribution.  This is an institution
-- attribution, not a claim about a particular AUSA.  It uses the docket's own
-- party role plus the filing court's mapped USAO.
INSERT INTO usao_case_assignment (
  office_id, case_id, relationship, evidence_type, source_artifact_id,
  confidence, matcher_version
)
SELECT DISTINCT
  office.id,
  appearance.case_id,
  'filed_or_prosecuted',
  'party_role_and_district',
  appearance.source_artifact_id,
  0.995,
  'usao-party-district-v1'
FROM party_appearance appearance
JOIN entity party ON party.id = appearance.entity_id
JOIN legal_case legal_case ON legal_case.id = appearance.case_id
JOIN usao_office office ON office.district_court_id = legal_case.court_id
WHERE appearance.role IN ('plaintiff', 'petitioner', 'appellant')
  AND lower(regexp_replace(party.display_name, '[^a-z0-9]+', '', 'g'))
    IN ('unitedstates', 'unitedstatesofamerica')
ON CONFLICT (office_id, case_id, relationship) DO NOTHING;

CREATE OR REPLACE VIEW usao_office_analytics AS
SELECT
  office.id,
  office.public_id,
  office.office_code,
  office.display_name,
  office.district_court_id,
  count(assignment.id)::integer AS case_count,
  count(*) FILTER (WHERE legal_case.activity_state = 'active')::integer AS active_case_count,
  max(legal_case.filed_on) AS latest_case_filed_on,
  count(DISTINCT attorney.id)::integer AS attorney_count
FROM usao_office office
LEFT JOIN usao_case_assignment assignment ON assignment.office_id = office.id
LEFT JOIN legal_case ON legal_case.id = assignment.case_id
LEFT JOIN usao_attorney attorney ON attorney.office_id = office.id AND attorney.active IS NOT FALSE
GROUP BY office.id;

COMMIT;
