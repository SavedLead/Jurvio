BEGIN;

INSERT INTO provider (code, name, base_url)
VALUES ('scotus_official', 'Supreme Court of the United States', 'https://www.supremecourt.gov')
ON CONFLICT (code) DO NOTHING;

CREATE TYPE ingestion_candidate_status AS ENUM ('pending_review', 'approved', 'rejected');

CREATE TABLE official_opinion_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider(id),
  term_year text NOT NULL CHECK (term_year ~ '^[0-9]{2}$'),
  source_record_id text NOT NULL,
  release_number text,
  docket_number text NOT NULL,
  case_name text NOT NULL,
  filed_on date NOT NULL,
  author_code text,
  citation text,
  source_pdf_uri text NOT NULL,
  source_content_hash text NOT NULL,
  listing_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  opinion_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  review_status ingestion_candidate_status NOT NULL DEFAULT 'pending_review',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewer_id uuid REFERENCES internal_user(id),
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, source_record_id),
  UNIQUE (provider_id, source_pdf_uri)
);

CREATE INDEX official_opinion_candidate_review_idx
  ON official_opinion_candidate (filed_on DESC, created_at)
  WHERE review_status = 'pending_review';

COMMIT;
