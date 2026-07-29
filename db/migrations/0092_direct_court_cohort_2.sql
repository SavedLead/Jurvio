BEGIN;

INSERT INTO direct_court_registry (
  court_code, court_name, jurvio_court_code, court_type, circuit,
  official_website, cmecf_base_url, rss_url, rss_available, rss_coverage_hours,
  included_event_categories, pacer_court_id, opinion_url, calendar_url,
  time_zone, polling_minutes, adapter_type
) VALUES
  (
    'cand', 'United States District Court for the Northern District of California',
    'cand', 'district', '9', 'https://www.cand.uscourts.gov',
    'https://ecf.cand.uscourts.gov',
    'https://ecf.cand.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'cand', NULL, NULL,
    'America/Los_Angeles', 5, 'cmecf-rss-v1'
  ),
  (
    'casd', 'United States District Court for the Southern District of California',
    'casd', 'district', '9', 'https://www.casd.uscourts.gov',
    'https://ecf.casd.uscourts.gov',
    'https://ecf.casd.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'casd', NULL, NULL,
    'America/Los_Angeles', 5, 'cmecf-rss-v1'
  ),
  (
    'wawd', 'United States District Court for the Western District of Washington',
    'wawd', 'district', '9', 'https://www.wawd.uscourts.gov',
    'https://ecf.wawd.uscourts.gov',
    'https://ecf.wawd.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'wawd', NULL, NULL,
    'America/Los_Angeles', 5, 'cmecf-rss-v1'
  )
ON CONFLICT (court_code) DO UPDATE SET
  court_name = EXCLUDED.court_name,
  jurvio_court_code = EXCLUDED.jurvio_court_code,
  court_type = EXCLUDED.court_type,
  circuit = EXCLUDED.circuit,
  official_website = EXCLUDED.official_website,
  cmecf_base_url = EXCLUDED.cmecf_base_url,
  rss_url = EXCLUDED.rss_url,
  rss_available = EXCLUDED.rss_available,
  rss_coverage_hours = EXCLUDED.rss_coverage_hours,
  included_event_categories = EXCLUDED.included_event_categories,
  pacer_court_id = EXCLUDED.pacer_court_id,
  opinion_url = EXCLUDED.opinion_url,
  calendar_url = EXCLUDED.calendar_url,
  time_zone = EXCLUDED.time_zone,
  polling_minutes = EXCLUDED.polling_minutes,
  adapter_type = EXCLUDED.adapter_type,
  updated_at = now();

COMMIT;
