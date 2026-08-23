BEGIN;

ALTER TABLE usao_attorney
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS source_record_key text,
  ADD COLUMN IF NOT EXISTS first_observed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_completeness smallint NOT NULL DEFAULT 0
    CHECK (profile_completeness BETWEEN 0 AND 100);

CREATE UNIQUE INDEX IF NOT EXISTS usao_attorney_source_record_key_idx
  ON usao_attorney (source_system, source_record_key)
  WHERE source_record_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS usao_attorney_public_directory_idx
  ON usao_attorney (active, verification, display_name);

CREATE TABLE IF NOT EXISTS usao_roster_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  source_url text NOT NULL,
  source_content_hash text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  discovered_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW usao_attorney_public_directory AS
SELECT
  attorney.id,
  attorney.public_id,
  attorney.display_name,
  attorney.title,
  attorney.division,
  attorney.biography,
  attorney.official_profile_url,
  attorney.photo_url,
  attorney.photo_source_url,
  attorney.active,
  attorney.verification,
  attorney.source_system,
  attorney.last_verified_at,
  attorney.profile_completeness,
  office.public_id AS office_public_id,
  office.display_name AS office_display_name,
  count(DISTINCT appearance.case_id)::integer AS case_count,
  max(appearance.observed_on) AS latest_appearance_on
FROM usao_attorney attorney
JOIN usao_office office ON office.id = attorney.office_id
LEFT JOIN usao_attorney_case_appearance appearance ON appearance.attorney_id = attorney.id
WHERE attorney.verification <> 'rejected'
GROUP BY attorney.id, office.id;

COMMIT;
