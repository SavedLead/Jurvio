-- Per-court freshness for the admin backend (/internal/freshness).
--
-- court_source_watermark: one row per (source, court). Every ingestion source
-- (CourtListener bulk, official SCOTUS, court-of-appeals feeds, district CM/ECF
-- RSS, the CourtListener date_modified tail) records when it last tried and
-- last succeeded for a court, its resume cursor, and any rate-limit back-off.
--
-- court_freshness: one precomputed row per tracked federal court (SCOTUS, the
-- 13 courts of appeals, the 94 district courts). The admin page reads only
-- these ~108 rows. The per-court aggregates over legal_case are computed by the
-- core-lane `court-freshness` job and by the feed jobs for the courts they just
-- touched, never by a page request.
--
-- Both tables are new and empty, so this migration takes no lock on existing
-- tables and does no table rewrite.

CREATE TABLE IF NOT EXISTS court_source_watermark (
  source text NOT NULL CHECK (source IN ('bulk', 'scotus_official', 'coa_feed', 'district_rss', 'courtlistener')),
  court_code text NOT NULL,
  cursor_value text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_new_item_at timestamptz,
  newest_item_at timestamptz,
  items_fetched_last integer NOT NULL DEFAULT 0,
  new_cases_last integer NOT NULL DEFAULT 0,
  new_entries_last integer NOT NULL DEFAULT 0,
  items_fetched_total bigint NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  retry_after_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, court_code)
);

CREATE TABLE IF NOT EXISTS court_freshness (
  court_code text PRIMARY KEY,
  court_type text NOT NULL CHECK (court_type IN ('supreme', 'appellate', 'district')),
  name text NOT NULL,
  circuit text,
  case_count bigint NOT NULL DEFAULT 0,
  published_count bigint NOT NULL DEFAULT 0,
  draft_count bigint NOT NULL DEFAULT 0,
  withheld_count bigint NOT NULL DEFAULT 0,
  newest_filed_on date,
  newest_case_created_at timestamptz,
  last_bulk_at timestamptz,
  last_feed_at timestamptz,
  last_courtlistener_at timestamptz,
  feed_available boolean NOT NULL DEFAULT false,
  feed_health text,
  feed_failures integer NOT NULL DEFAULT 0,
  courtlistener_retry_after timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
