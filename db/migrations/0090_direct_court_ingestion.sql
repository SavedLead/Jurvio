BEGIN;

INSERT INTO provider (code, name, base_url)
VALUES ('official_cmecf', 'Official federal court CM/ECF', 'https://pacer.uscourts.gov')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE direct_court_registry (
  court_code text PRIMARY KEY,
  court_name text NOT NULL,
  jurvio_court_code text NOT NULL,
  court_type text NOT NULL CHECK (court_type IN ('district','appellate','bankruptcy')),
  circuit text,
  official_website text NOT NULL,
  cmecf_base_url text NOT NULL,
  rss_url text,
  rss_available boolean NOT NULL DEFAULT false,
  rss_coverage_hours integer,
  included_event_categories jsonb NOT NULL DEFAULT '[]',
  pacer_court_id text,
  opinion_url text,
  calendar_url text,
  time_zone text NOT NULL,
  polling_minutes integer NOT NULL CHECK (polling_minutes BETWEEN 2 AND 60),
  adapter_type text NOT NULL,
  checkpoint text,
  last_successful_retrieval timestamptz,
  health_state text NOT NULL DEFAULT 'unknown',
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE direct_court_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_code text NOT NULL REFERENCES direct_court_registry(court_code),
  case_id uuid REFERENCES legal_case(id),
  raw_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  docket_number text NOT NULL,
  caption text NOT NULL,
  official_event_id text,
  document_number text,
  official_filed_at timestamptz NOT NULL,
  exact_docket_text text NOT NULL,
  event_type text NOT NULL,
  visitor_description text NOT NULL,
  official_source_url text NOT NULL,
  document_url text,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  deduplication_key text NOT NULL CHECK (deduplication_key ~ '^[a-f0-9]{64}$'),
  restricted boolean NOT NULL DEFAULT false,
  publication_state text NOT NULL DEFAULT 'pending'
    CHECK (publication_state IN ('pending','published','suppressed','needs_review')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (court_code, deduplication_key)
);

CREATE INDEX direct_court_event_case_time_idx
  ON direct_court_event (case_id, official_filed_at, id) WHERE case_id IS NOT NULL;
CREATE INDEX direct_court_event_unmatched_idx
  ON direct_court_event (court_code, docket_number) WHERE case_id IS NULL;

CREATE TABLE direct_court_alert_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direct_event_id uuid NOT NULL UNIQUE REFERENCES direct_court_event(id),
  case_id uuid NOT NULL REFERENCES legal_case(id),
  public_payload jsonb NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pacer_cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  court_code text,
  transaction_type text NOT NULL,
  source_reference text NOT NULL,
  estimated_cost_cents integer NOT NULL DEFAULT 0 CHECK (estimated_cost_cents >= 0),
  actual_cost_cents integer CHECK (actual_cost_cents >= 0),
  artifact_content_hash text,
  UNIQUE (transaction_type, source_reference, artifact_content_hash)
);

INSERT INTO direct_court_registry (
  court_code, court_name, jurvio_court_code, court_type, circuit,
  official_website, cmecf_base_url, rss_url, rss_available, rss_coverage_hours,
  included_event_categories, pacer_court_id, calendar_url, time_zone,
  polling_minutes, adapter_type
) VALUES (
  'txwd', 'United States District Court for the Western District of Texas',
  'txwd', 'district', '5', 'https://www.txwd.uscourts.gov',
  'https://ecf.txwd.uscourts.gov',
  'https://ecf.txwd.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
  '["all"]', 'txwd',
  'https://www.txwd.uscourts.gov/court-information/court-calendars/',
  'America/Chicago', 5, 'cmecf-rss-v1'
) ON CONFLICT (court_code) DO UPDATE SET
  rss_url = EXCLUDED.rss_url, rss_available = EXCLUDED.rss_available,
  rss_coverage_hours = EXCLUDED.rss_coverage_hours,
  polling_minutes = EXCLUDED.polling_minutes, updated_at = now();

COMMIT;
