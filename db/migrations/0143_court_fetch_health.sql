-- Court fetch health (free-feeds plan, step 1).
--
-- court_fetch_log: one row per HTTP request a court feed job makes (district
-- RSS, circuit pages and feeds, GovInfo, court websites). It records the HTTP
-- status, error, bytes, items parsed and new items, plus the 28-day same-weekday
-- average item count for that court + source + URL and a zero-items-vs-baseline
-- flag. Failed fetches are logged before anything throws, so a court can no
-- longer sit at health 'unknown' after a 404.
--
-- court_source: the court x source matrix (which free sources exist for a
-- court, whether Jurvio polls them). Kept in sync by the court-freshness job
-- from the checked-in catalog (src/modules/operations/domain/court-sources.ts).
--
-- Both tables are small and only written by feed jobs; nothing public reads them.

CREATE TABLE IF NOT EXISTS court_fetch_log (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  court_code text NOT NULL,
  url text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  http_status integer,
  ok boolean NOT NULL,
  error text,
  bytes integer,
  items integer,
  new_items integer,
  baseline_items numeric(10, 2),
  zero_vs_baseline boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS court_fetch_log_court_source_idx
  ON court_fetch_log (court_code, source, fetched_at DESC);
CREATE INDEX IF NOT EXISTS court_fetch_log_fetched_at_idx
  ON court_fetch_log (fetched_at);

CREATE TABLE IF NOT EXISTS court_source (
  court_code text NOT NULL,
  source text NOT NULL,
  label text NOT NULL,
  url text,
  available boolean NOT NULL,
  enabled boolean NOT NULL,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (court_code, source)
);

ALTER TABLE court_source_watermark DROP CONSTRAINT IF EXISTS court_source_watermark_source_check;
ALTER TABLE court_source_watermark ADD CONSTRAINT court_source_watermark_source_check CHECK (source = ANY (ARRAY[
  'bulk', 'scotus_official', 'coa_feed', 'district_rss', 'courtlistener',
  'appellate_official', 'govinfo', 'court_site', 'appellate_pacer_rss'
]::text[]));
