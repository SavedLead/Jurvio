BEGIN;

-- Google News RSS is off (2026-11-01, David Rosenberg): its feed terms allow
-- personal, non-commercial use only. Remove every link it produced so none can
-- be shown or reviewed. At the time of this migration none had been published
-- (419 items seen, all rejected below the review threshold). case_news_run
-- health rows for the source are kept as history.
DELETE FROM case_news_link WHERE source = 'google_news_rss';

-- One-party matches (a distinctive party plus the court, no docket) go to the
-- review queue only; never auto-published (score capped below 0.85 in code).
ALTER TABLE case_news_link DROP CONSTRAINT IF EXISTS case_news_link_match_method_check;
ALTER TABLE case_news_link ADD CONSTRAINT case_news_link_match_method_check
  CHECK (match_method IN ('docket_number', 'case_name_court', 'parties_court_timeframe', 'single_party_court'));

COMMIT;
