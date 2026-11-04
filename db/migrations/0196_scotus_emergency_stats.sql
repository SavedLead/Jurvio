-- Emergency docket analytics v2 (Pro page /supreme-court/emergency/analytics).
--
-- scotus_application.source_lane: 'live' for rows the 10-minute lane writes,
--   'history' for rows the builder's history backfill loaded from earlier
--   docket years (17A..). A history re-run may refresh its own rows but never
--   overwrites a live row.
-- scotus_emergency_stat: precomputed counts, one row per combination of the
--   dimensions the page filters and charts by (docket year, administration,
--   applicant, lower court group, justice the application went to, kind,
--   outcome, days to ruling, ...). Rebuilt in one transaction by the
--   scotus-emergency job (src/modules/scotus/application/emergency-stats.ts)
--   when applications changed, so the page only sums a few thousand small rows
--   and never scans applications or docket lines per page view.
-- scotus_emergency_stat_vote: publicly noted votes (dissents, "would grant")
--   per justice with the same filter dimensions.
-- scotus_emergency_stat_meta: when the counts were rebuilt and what they cover.
-- Only applications that pass the same visibility rule as the public list
-- (and therefore the strict sealed/restricted filter) are counted.

ALTER TABLE scotus_application ADD COLUMN IF NOT EXISTS source_lane text NOT NULL DEFAULT 'live';
ALTER TABLE scotus_application DROP CONSTRAINT IF EXISTS scotus_application_source_lane_check;
ALTER TABLE scotus_application ADD CONSTRAINT scotus_application_source_lane_check CHECK (source_lane IN ('live', 'history'));

CREATE TABLE IF NOT EXISTS scotus_emergency_stat (
  term smallint NOT NULL,
  administration text,
  applicant_kind text NOT NULL,
  lower_group text NOT NULL,
  justice text,
  extension boolean NOT NULL,
  kind text NOT NULL,
  outcome text NOT NULL,
  referred boolean NOT NULL,
  response_requested boolean NOT NULL,
  admin_stay boolean NOT NULL,
  written boolean NOT NULL,
  -- Days from filing to ruling, capped at 61 ("over 60"); NULL when not decided.
  days smallint,
  applications integer NOT NULL,
  with_votes integer NOT NULL
);
CREATE INDEX IF NOT EXISTS scotus_emergency_stat_term_idx ON scotus_emergency_stat (extension, term);

CREATE TABLE IF NOT EXISTS scotus_emergency_stat_vote (
  term smallint NOT NULL,
  applicant_kind text NOT NULL,
  lower_group text NOT NULL,
  extension boolean NOT NULL,
  voter text NOT NULL,
  position text NOT NULL,
  notes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS scotus_emergency_stat_meta (
  id smallint PRIMARY KEY CHECK (id = 1),
  refreshed_at timestamptz NOT NULL,
  source_changed_at timestamptz,
  applications integer NOT NULL,
  history_applications integer NOT NULL,
  terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  stat_rows integer NOT NULL,
  elapsed_ms integer NOT NULL
);
