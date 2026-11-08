-- Official Supreme Court order lists, stored apart from docket entries.
-- Alert selection reads docket_entry.created_at. These tables are not alert
-- inputs, so a history load cannot notify subscribers.

CREATE TABLE IF NOT EXISTS scotus_order_list (
  source_record_id text PRIMARY KEY,
  term_year text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://www[.]supremecourt[.]gov/'),
  list_date date NOT NULL,
  list_kind text NOT NULL CHECK (list_kind IN ('order_list', 'miscellaneous', 'other')),
  label text NOT NULL,
  amended boolean NOT NULL DEFAULT false,
  index_entry_hash text NOT NULL CHECK (index_entry_hash ~ '^[a-f0-9]{64}$'),
  index_retrieved_at timestamptz NOT NULL,
  pdf_sha256 text CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_retrieved_at timestamptz,
  withheld_items integer NOT NULL DEFAULT 0,
  parser_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pdf_sha256 IS NULL OR pdf_retrieved_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS scotus_order_list_item (
  list_source_record_id text NOT NULL REFERENCES scotus_order_list(source_record_id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  docket_number text NOT NULL,
  caption text,
  section text NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('disposition', 'separate_writing')),
  disposition text,
  writing_kind text,
  body text,
  source_url text CHECK (source_url IS NULL OR source_url ~ '^https://www[.]supremecourt[.]gov/'),
  case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  PRIMARY KEY (list_source_record_id, source_item_id)
);

CREATE INDEX IF NOT EXISTS scotus_order_list_item_docket_idx
  ON scotus_order_list_item (docket_number);
