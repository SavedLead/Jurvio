-- Which emergency docket years the history backfill has read end to end.
-- A year is complete only after one scan read every number from 1 until 15
-- missing pages in a row with no unread page; a later partial rerun never
-- clears it. The analytics page hides or marks years that are not complete
-- so the by-year chart never shows a backfill gap as a quiet year.
CREATE TABLE IF NOT EXISTS scotus_emergency_history_coverage (
  term integer PRIMARY KEY CHECK (term BETWEEN 2000 AND 2099),
  complete boolean NOT NULL DEFAULT false,
  highest_number integer NOT NULL DEFAULT 0,
  pages integer NOT NULL DEFAULT 0,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
