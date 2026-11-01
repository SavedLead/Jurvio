-- EDNY public docket feed (free-feeds plan, step 2).
--
-- EDNY turned off the standard PACER public feed (rss_outside.pl answers with
-- an empty body), but its Case Info page links a different public feed,
-- cgi-bin/readyDockets.pl: every public docket entry of the last 24 hours, in
-- the same RSS shape the district poller already parses. Its guid is the
-- case's docket-report URL rather than one per entry, so cmecf-rss.ts derives
-- the entry identity from docket + document number + time + text instead
-- (see entryGuid). Sealed entries ("[1 - Sealed Document]", "USA v. Sealed")
-- are flagged restricted at parse time and stored suppressed, never published.
UPDATE direct_court_registry SET
  rss_url = 'https://ecf.nyed.uscourts.gov/cgi-bin/readyDockets.pl',
  rss_available = true,
  rss_coverage_hours = 24,
  included_event_categories = '["all"]'::jsonb,
  health_state = 'unknown',
  consecutive_failures = 0,
  feed_etag = NULL,
  feed_last_modified = NULL,
  updated_at = now()
WHERE court_code = 'nyed' AND court_type = 'district';
