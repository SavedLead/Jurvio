BEGIN;

-- Official agency and settlement sources of federal case filings (DOJ, SEC,
-- FTC, state attorneys general, class-action settlement administrators).
-- Separate from the 0012 government_litigation_lead scaffold on purpose:
-- items here never get their own public or sitemap pages. They are shown,
-- with attribution, only on an already-published case page and only when
-- the item itself states the court and docket number that match that case
-- exactly. Everything else waits in the internal review queue.

CREATE TABLE agency_source (
  code text PRIMARY KEY,
  name text NOT NULL,
  agency_kind text NOT NULL CHECK (agency_kind IN ('doj', 'sec', 'ftc', 'state_ag', 'settlement_admin')),
  jurisdiction text,
  publisher text NOT NULL,
  home_url text NOT NULL,
  feed_url text,
  enabled boolean NOT NULL DEFAULT true,
  cursor_value text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agency_source_run (
  id bigserial PRIMARY KEY,
  source_code text NOT NULL REFERENCES agency_source(code),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ok', 'partial', 'failed', 'blocked', 'rate_limited', 'skipped')),
  requests integer NOT NULL DEFAULT 0,
  items_seen integer NOT NULL DEFAULT 0,
  items_new integer NOT NULL DEFAULT 0,
  refs_found integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  queued integer NOT NULL DEFAULT 0,
  restricted integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX agency_source_run_source_idx ON agency_source_run (source_code, started_at DESC);

CREATE TABLE agency_source_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code text NOT NULL REFERENCES agency_source(code),
  source_record_id text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  title text NOT NULL,
  item_kind text NOT NULL,
  issuing_office text,
  published_at timestamptz,
  official_excerpt text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  settlement_amount text,
  restricted boolean NOT NULL DEFAULT false,
  restricted_reason text,
  review_status text NOT NULL DEFAULT 'queued' CHECK (review_status IN ('queued', 'linked', 'not_court', 'rejected')),
  content_hash text NOT NULL,
  change_key text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_code, source_record_id),
  CHECK (NOT restricted OR review_status <> 'linked')
);
CREATE INDEX agency_source_item_queue_idx ON agency_source_item (review_status, first_seen_at DESC);

-- One row per (court, docket number) the item itself states.
CREATE TABLE agency_item_case_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES agency_source_item(id) ON DELETE CASCADE,
  docket_number text NOT NULL,
  court_code text,
  court_evidence text,
  match_status text NOT NULL CHECK (match_status IN ('matched', 'unmatched', 'ambiguous', 'no_court')),
  case_id uuid REFERENCES legal_case(id),
  match_note text,
  matched_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (item_id, docket_number, court_code),
  CHECK ((match_status = 'matched') = (case_id IS NOT NULL))
);
CREATE INDEX agency_item_case_ref_case_idx ON agency_item_case_ref (case_id) WHERE case_id IS NOT NULL;
CREATE INDEX agency_item_case_ref_recheck_idx ON agency_item_case_ref (checked_at) WHERE match_status <> 'matched';

COMMIT;
