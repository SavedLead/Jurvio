-- Court website opinion pages and appellate CM/ECF RSS (free-feeds plan, step 5).
--
-- free_source_item: one row per item a free source listed (source + item key:
-- the PDF URL for court sites, the RSS guid for appellate RSS), with what the
-- job did: 'matched' (another source already had the same kind of entry on
-- that case within a day), 'entry', 'new_case', 'restricted', 'ambiguous',
-- 'unmatched' (no case and not enough docket detail to create one safely).
-- Idempotency key and per-court cross-check report.

CREATE TABLE IF NOT EXISTS free_source_item (
  source text NOT NULL,
  item_key text NOT NULL,
  court_code text NOT NULL,
  docket_number text,
  issued_on date,
  outcome text NOT NULL CHECK (outcome IN ('matched', 'entry', 'new_case', 'restricted', 'ambiguous', 'unmatched')),
  case_id uuid,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, item_key)
);

CREATE INDEX IF NOT EXISTS free_source_item_court_seen_idx ON free_source_item (court_code, source, seen_at DESC);
