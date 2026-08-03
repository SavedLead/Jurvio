BEGIN;

INSERT INTO direct_court_registry (
  court_code, court_name, jurvio_court_code, court_type, circuit,
  official_website, cmecf_base_url, rss_url, rss_available, rss_coverage_hours,
  included_event_categories, pacer_court_id, opinion_url, calendar_url,
  time_zone, polling_minutes, adapter_type
) VALUES
  (
    'ded', 'United States District Court for the District of Delaware',
    'ded', 'district', '3', 'https://www.ded.uscourts.gov',
    'https://ecf.ded.uscourts.gov',
    'https://ecf.ded.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'ded', NULL, NULL, 'America/New_York', 5, 'cmecf-rss-v1'
  ),
  (
    'dcd', 'United States District Court for the District of Columbia',
    'dcd', 'district', 'DC', 'https://www.dcd.uscourts.gov',
    'https://ecf.dcd.uscourts.gov',
    'https://ecf.dcd.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'dcd', NULL, NULL, 'America/New_York', 5, 'cmecf-rss-v1'
  ),
  (
    'mad', 'United States District Court for the District of Massachusetts',
    'mad', 'district', '1', 'https://www.mad.uscourts.gov',
    'https://ecf.mad.uscourts.gov',
    'https://ecf.mad.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'mad', NULL, NULL, 'America/New_York', 5, 'cmecf-rss-v1'
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
