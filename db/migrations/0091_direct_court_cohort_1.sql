BEGIN;

INSERT INTO direct_court_registry (
  court_code, court_name, jurvio_court_code, court_type, circuit,
  official_website, cmecf_base_url, rss_url, rss_available, rss_coverage_hours,
  included_event_categories, pacer_court_id, opinion_url, calendar_url,
  time_zone, polling_minutes, adapter_type
) VALUES
  (
    'nysd', 'United States District Court for the Southern District of New York',
    'nysd', 'district', '2', 'https://www.nysd.uscourts.gov',
    'https://ecf.nysd.uscourts.gov',
    'https://ecf.nysd.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["answers","appeals","complaints","discovery","minutes","motions","notices","orders","pleas","responses","service","transfers","trials"]',
    'nysd', 'https://www.nysd.uscourts.gov/courtweb',
    'https://www.nysd.uscourts.gov/court-calendars',
    'America/New_York', 5, 'cmecf-rss-v1'
  ),
  (
    'njd', 'United States District Court for the District of New Jersey',
    'njd', 'district', '3', 'https://www.njd.uscourts.gov',
    'https://ecf.njd.uscourts.gov',
    'https://ecf.njd.uscourts.gov/cgi-bin/rss_outside.pl', true, 24,
    '["all"]', 'njd', 'https://www.njd.uscourts.gov/opinions',
    'https://www.njd.uscourts.gov/court-info/court-calendars',
    'America/New_York', 5, 'cmecf-rss-v1'
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
