-- Supreme Court orders lists (phase 1). Official Orders of the Court index,
-- scheduled order-list text, and the opinions-relating-to-orders index.
--
-- alert_eligible is locked false: these rows cannot feed case-follow mail or
-- a new subscriber feed until a later migration drops the check. Backfilled
-- rows stay marked so a later unlock still skips history.
-- A withheld line keeps its docket number and a hash, never the Court's words.

CREATE TABLE IF NOT EXISTS scotus_orders_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.supremecourt\.gov/'),
  term_year smallint NOT NULL CHECK (term_year BETWEEN 0 AND 99),
  posted_on date NOT NULL,
  label text NOT NULL CHECK (label IN ('order_list', 'miscellaneous', 'separate_writing')),
  content_hash text NOT NULL CHECK (length(content_hash) BETWEEN 7 AND 64),
  parse_status text NOT NULL CHECK (parse_status IN ('pending', 'indexed', 'parsed', 'failed')),
  superseded_by uuid,
  backfilled boolean NOT NULL DEFAULT true,
  last_modified text,
  entry_count integer NOT NULL DEFAULT 0,
  withheld_count integer NOT NULL DEFAULT 0,
  parser_version text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_url, content_hash)
);

ALTER TABLE scotus_orders_list DROP CONSTRAINT IF EXISTS scotus_orders_list_superseded_by_fkey;
ALTER TABLE scotus_orders_list
  ADD CONSTRAINT scotus_orders_list_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES scotus_orders_list(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS scotus_orders_list_current_idx
  ON scotus_orders_list (term_year, posted_on DESC)
  WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS scotus_orders_entry (
  source_record_id text PRIMARY KEY CHECK (length(source_record_id) = 64),
  list_id uuid NOT NULL REFERENCES scotus_orders_list(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  docket_number text CHECK (docket_number IS NULL OR length(docket_number) BETWEEN 2 AND 40),
  section text NOT NULL CHECK (length(section) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN (
    'cert_denied', 'cert_granted', 'summary_disposition', 'rehearing_denied',
    'habeas_denied', 'mandamus_denied', 'prohibition_denied', 'attorney_discipline',
    'motion_granted', 'motion_denied', 'pending_order', 'amendment',
    'separate_writing', 'merits_ruling', 'other', 'withheld'
  )),
  merits boolean NOT NULL DEFAULT false CHECK (merits = (kind = 'merits_ruling')),
  caption text CHECK (caption IS NULL OR length(caption) <= 1000),
  exact_wording text CHECK (exact_wording IS NULL OR length(exact_wording) <= 100000),
  plain_line text CHECK (plain_line IS NULL OR length(plain_line) <= 500),
  author_text text CHECK (author_text IS NULL OR length(author_text) <= 80),
  citation text CHECK (citation IS NULL OR length(citation) <= 40),
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.supremecourt\.gov/'),
  withheld boolean NOT NULL DEFAULT false,
  case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  match_status text NOT NULL CHECK (match_status IN ('matched', 'unmatched', 'ambiguous', 'withheld')),
  match_candidates integer NOT NULL DEFAULT 0,
  amended_from text,
  backfilled boolean NOT NULL DEFAULT true,
  alert_eligible boolean NOT NULL DEFAULT false CHECK (alert_eligible = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT withheld OR (exact_wording IS NULL AND plain_line IS NULL AND caption IS NULL AND author_text IS NULL))
);

CREATE INDEX IF NOT EXISTS scotus_orders_entry_list_idx ON scotus_orders_entry (list_id, position);
CREATE INDEX IF NOT EXISTS scotus_orders_entry_docket_idx ON scotus_orders_entry (docket_number) WHERE docket_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS scotus_orders_coverage (
  term_year smallint PRIMARY KEY CHECK (term_year BETWEEN 0 AND 99),
  run_succeeded boolean NOT NULL,
  complete boolean NOT NULL,
  orders_index_known boolean NOT NULL,
  relating_index_known boolean NOT NULL,
  missed_count integer NOT NULL,
  stale_count integer NOT NULL,
  failure_count integer NOT NULL,
  withheld_count integer NOT NULL,
  newest_posted_on date,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);
