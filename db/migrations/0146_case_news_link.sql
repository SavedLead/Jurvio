-- "In the news" for case pages (David Rosenberg, 2026-10-31).
--
-- case_news_link stores only link metadata a source provides: headline, outlet,
-- date, URL and at most a short snippet the source itself publishes (an RSS
-- description). Article text is never fetched or stored.
--
-- Matching is high-precision (src/modules/case-news/domain/match.ts). Every row
-- keeps its method, score and evidence. Only review_status 'auto_published' or
-- 'approved' rows are shown, and the read path re-checks that the case is not
-- sealed or restricted, so a case that becomes restricted later hides its news.

CREATE TABLE IF NOT EXISTS case_news_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  url text NOT NULL,
  outlet text NOT NULL,
  outlet_domain text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 400),
  snippet text CHECK (snippet IS NULL OR length(snippet) <= 300),
  published_at timestamptz NOT NULL,
  source text NOT NULL,
  match_method text NOT NULL CHECK (match_method IN ('docket_number', 'case_name_court', 'parties_court_timeframe')),
  match_score numeric(4,3) NOT NULL CHECK (match_score BETWEEN 0 AND 1),
  match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_rule_version text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('auto_published', 'pending_review', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, url)
);

CREATE INDEX IF NOT EXISTS case_news_link_case_visible_idx
  ON case_news_link (case_id, published_at DESC)
  WHERE review_status IN ('auto_published', 'approved');

CREATE INDEX IF NOT EXISTS case_news_link_recent_visible_idx
  ON case_news_link (published_at DESC)
  WHERE review_status IN ('auto_published', 'approved');

CREATE INDEX IF NOT EXISTS case_news_link_review_queue_idx
  ON case_news_link (first_seen_at DESC)
  WHERE review_status = 'pending_review';

-- Per-case query schedule so the job rotates through candidates politely.
CREATE TABLE IF NOT EXISTS case_news_query_state (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  priority_tier text NOT NULL,
  last_queried_at timestamptz,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  last_result_count integer NOT NULL DEFAULT 0,
  last_error text,
  query_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS case_news_query_state_due_idx ON case_news_query_state (next_due_at);

-- One row per job run and source: the health log for /internal and diagnostics.
CREATE TABLE IF NOT EXISTS case_news_run (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  cases_queried integer NOT NULL DEFAULT 0,
  items_seen integer NOT NULL DEFAULT 0,
  links_published integer NOT NULL DEFAULT 0,
  links_review integer NOT NULL DEFAULT 0,
  rejected_low_score integer NOT NULL DEFAULT 0,
  skipped_restricted integer NOT NULL DEFAULT 0,
  rate_limited boolean NOT NULL DEFAULT false,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS case_news_run_source_finished_idx ON case_news_run (source, finished_at DESC);
