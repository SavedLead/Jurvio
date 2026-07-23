BEGIN;

CREATE TABLE government_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  agency text NOT NULL CHECK (agency IN ('doj', 'sec', 'ftc', 'osha', 'executive_office')),
  source_kind text NOT NULL CHECK (source_kind IN ('press_release', 'litigation_release', 'enforcement_release', 'news_release', 'executive_order')),
  official_base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE government_litigation_lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  government_source_id uuid NOT NULL REFERENCES government_source(id),
  source_record_id text NOT NULL,
  source_url text NOT NULL,
  source_title text NOT NULL,
  source_published_at timestamptz,
  attributed_summary text NOT NULL,
  review_status text NOT NULL DEFAULT 'discovered' CHECK (review_status IN ('discovered', 'matched', 'reviewed', 'published', 'rejected')),
  linked_case_id uuid REFERENCES legal_case(id),
  match_method text CHECK (match_method IS NULL OR match_method IN ('court_identifier', 'docket_number', 'manual')),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (government_source_id, source_record_id),
  CHECK (review_status <> 'published' OR (reviewed_at IS NOT NULL AND published_at IS NOT NULL)),
  CHECK (linked_case_id IS NULL OR match_method IS NOT NULL)
);

CREATE INDEX government_litigation_lead_public_idx
  ON government_litigation_lead (source_published_at DESC, public_id)
  WHERE review_status = 'published';
CREATE INDEX government_litigation_lead_review_idx
  ON government_litigation_lead (review_status, created_at);

INSERT INTO government_source (code, name, agency, source_kind, official_base_url) VALUES
  ('doj-press-releases', 'U.S. Department of Justice press releases', 'doj', 'press_release', 'https://www.justice.gov/news'),
  ('sec-litigation-releases', 'U.S. Securities and Exchange Commission litigation releases', 'sec', 'litigation_release', 'https://www.sec.gov/enforcement-litigation/litigation-releases'),
  ('ftc-press-releases', 'Federal Trade Commission press releases', 'ftc', 'enforcement_release', 'https://www.ftc.gov/news-events/news/press-releases'),
  ('osha-news-releases', 'Occupational Safety and Health Administration news releases', 'osha', 'news_release', 'https://www.osha.gov/news/newsreleases'),
  ('federal-register-executive-orders', 'Federal Register presidential documents', 'executive_office', 'executive_order', 'https://www.federalregister.gov/presidential-documents/executive-orders');

COMMIT;
