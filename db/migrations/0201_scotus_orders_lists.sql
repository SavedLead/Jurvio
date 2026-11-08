-- Official Supreme Court orders lists (supremecourt.gov Order List PDFs).
--
-- A row in scotus_orders_list_coverage records one monitor run. last_run_status
-- can be 'succeeded' while completeness is still 'incomplete': success means
-- the index was read and this run stored what it could; completeness means
-- every orders-list link currently on that term's index has stored text.
-- Neither status claims that every Court order or opinion is in Jurvio.
--
-- notify is forced false. Subscriber mail for this feed stays off until a
-- later reviewed migration drops that check. backfilled rows also cannot
-- be marked notify, so a historical backfill cannot email followers.
-- Withheld rows store no caption, text, or separate writing.

CREATE TABLE IF NOT EXISTS scotus_orders_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_year integer NOT NULL CHECK (term_year BETWEEN 1990 AND 2100),
  list_date date NOT NULL,
  index_date date NOT NULL,
  printed_date date,
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.supremecourt\.gov/orders/courtorders/.+\.pdf$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL CHECK (revision >= 1),
  superseded_at timestamptz,
  extraction_status text NOT NULL CHECK (extraction_status IN ('ok', 'failed')),
  backfilled boolean NOT NULL,
  parser_version text NOT NULL,
  artifact_id uuid REFERENCES raw_artifact(id),
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_url, content_hash)
);

CREATE INDEX IF NOT EXISTS scotus_orders_list_term_idx ON scotus_orders_list (term_year, list_date DESC);

CREATE TABLE IF NOT EXISTS scotus_orders_list_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES scotus_orders_list(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  section_heading text NOT NULL,
  docket_number text,
  caption text,
  action text NOT NULL CHECK (action IN (
    'cert_denied', 'cert_granted', 'cert_dismissed', 'summary_disposition', 'merits_decision',
    'procedural_order', 'habeas_denied', 'mandamus_denied', 'rehearing_denied', 'separate_writing', 'unclassified'
  )),
  exact_text text NOT NULL DEFAULT '',
  separate_writings jsonb NOT NULL DEFAULT '[]'::jsonb,
  plain_headline text NOT NULL,
  plain_detail text NOT NULL,
  uncertainty text,
  withheld boolean NOT NULL DEFAULT false,
  link_status text NOT NULL CHECK (link_status IN ('linked', 'unlinked', 'ambiguous', 'withheld')),
  case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  backfilled boolean NOT NULL,
  notify boolean NOT NULL DEFAULT false,
  text_hash text NOT NULL CHECK (text_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (list_id, ordinal),
  CHECK (notify = false),
  CHECK (NOT backfilled OR NOT notify),
  CHECK (link_status <> 'linked' OR case_id IS NOT NULL),
  CHECK (link_status = 'linked' OR case_id IS NULL),
  CHECK (
    link_status <> 'withheld'
    OR (case_id IS NULL AND caption IS NULL AND exact_text = '' AND separate_writings = '[]'::jsonb AND withheld)
  )
);

CREATE INDEX IF NOT EXISTS scotus_orders_list_entry_case_idx ON scotus_orders_list_entry (case_id);
CREATE INDEX IF NOT EXISTS scotus_orders_list_entry_docket_idx ON scotus_orders_list_entry (docket_number);

CREATE TABLE IF NOT EXISTS scotus_orders_list_index (
  term_year integer NOT NULL CHECK (term_year BETWEEN 1990 AND 2100),
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.supremecourt\.gov/orders/courtorders/.+\.pdf$'),
  list_date date NOT NULL,
  label text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (term_year, source_url)
);

CREATE TABLE IF NOT EXISTS scotus_orders_list_coverage (
  term_year integer PRIMARY KEY CHECK (term_year BETWEEN 1990 AND 2100),
  live_since timestamptz,
  last_run_at timestamptz,
  last_run_status text NOT NULL CHECK (last_run_status IN ('succeeded', 'partial', 'failed', 'rate_limited', 'paused')),
  last_success_at timestamptz,
  indexed_lists integer NOT NULL DEFAULT 0,
  stored_lists integer NOT NULL DEFAULT 0,
  stored_with_text integer NOT NULL DEFAULT 0,
  pending_lists integer NOT NULL DEFAULT 0,
  failed_lists integer NOT NULL DEFAULT 0,
  withheld_entries integer NOT NULL DEFAULT 0,
  unlinked_entries integer NOT NULL DEFAULT 0,
  ambiguous_entries integer NOT NULL DEFAULT 0,
  newest_indexed_on date,
  newest_stored_on date,
  backfill_remaining integer NOT NULL DEFAULT 0,
  rate_limit_until timestamptz,
  completeness text NOT NULL CHECK (completeness IN ('complete_for_indexed_lists', 'incomplete')),
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
