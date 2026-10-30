-- Precomputed public directory counts (see ADR 0080).
--
-- /judges ran count(DISTINCT legal_case.id) over every judge assignment, with a
-- correlated latest-publication lookup per case, on every request (1.8-2.0 s
-- TTFB, uncached). /courts/[id] counted every published case of the court on
-- every request (0.27-0.53 s, uncached), and /courts plus the /cases court
-- facet ran the same GROUP BY over all ~512k published cases every five minutes.
--
-- The citations-lane job `public-directory-stats` refreshes these rows in small
-- committed batches. Public reads use them and fall back to the live query when
-- a row (or the table) is missing.
--
-- Both tables are new and empty, so this migration takes no lock on existing
-- tables beyond the FK reference check and is safe to apply before the code.

CREATE TABLE IF NOT EXISTS court_public_stats (
  court_id uuid PRIMARY KEY REFERENCES court(id) ON DELETE CASCADE,
  case_count integer NOT NULL CHECK (case_count >= 0),
  latest_case_date date,
  -- Newest 100 displayable cases (filed_on DESC NULLS LAST, caption). Readers
  -- re-check visibility per id, so an unpublished case never shows.
  recent_case_ids uuid[] NOT NULL DEFAULT '{}',
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS court_public_stats_rank_idx
  ON court_public_stats (case_count DESC)
  WHERE case_count > 0;

CREATE TABLE IF NOT EXISTS judge_public_stats (
  judge_id uuid PRIMARY KEY REFERENCES judge(id) ON DELETE CASCADE,
  case_count integer NOT NULL CHECK (case_count >= 0),
  outcome_sample integer NOT NULL CHECK (outcome_sample >= 0),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS judge_public_stats_rank_idx
  ON judge_public_stats (case_count DESC, judge_id);
