-- Read-only gap check for appeals and district filings. One pass over
-- docket lines and one pass over cases whose court filing date is in the
-- last 365 days. No captions, docket numbers, or names.
-- RSS feeds only keep about a day, so they are counted apart from the
-- canonical lines.
\pset pager off
\x off

\echo == court jurisdiction census
SELECT coalesce(jurisdiction, '(null)') AS jurisdiction,
  count(*)::int AS courts
FROM court
GROUP BY 1
ORDER BY courts DESC, jurisdiction;

\echo == live rss stored in the last 30 days
SELECT 'district_rss'::text AS source,
  count(*)::int AS new_rows,
  min(first_seen_at) AS oldest,
  max(first_seen_at) AS newest
FROM direct_court_event
WHERE restricted = false
  AND first_seen_at >= now() - interval '30 days'
UNION ALL
SELECT 'appellate_pacer_rss'::text,
  count(*)::int,
  min(seen_at),
  max(seen_at)
FROM free_source_item
WHERE source = 'appellate_pacer_rss'
  AND outcome IN ('entry', 'new_case')
  AND seen_at >= now() - interval '30 days';

\echo == docket lines by filing day and court family
SELECT e.filed_on AS filed_on,
  CASE
    WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus' THEN 'scotus'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('fb', 'fbp')
      OR lower(coalesce(court.jurisdiction, '')) LIKE '%bankruptcy%' THEN 'bankruptcy'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('f')
      OR (
        lower(coalesce(court.jurisdiction, '')) LIKE '%appellate%'
        AND lower(coalesce(court.jurisdiction, '')) NOT LIKE '%bankruptcy%'
      ) THEN 'appeals'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('fd', 'federal')
      OR lower(coalesce(court.jurisdiction, '')) LIKE '%district%' THEN 'district'
    ELSE 'other'
  END AS family,
  count(*)::int AS lines
FROM docket_entry e
JOIN legal_case c ON c.id = e.case_id
JOIN court ON court.id = c.court_id
WHERE e.filed_on >= CURRENT_DATE - 365
  AND e.filed_on <= CURRENT_DATE
GROUP BY 1, 2
ORDER BY 1, 2;

\echo == docket line totals for 30, 60, 90, and 365 days
SELECT
  CASE
    WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus' THEN 'scotus'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('fb', 'fbp')
      OR lower(coalesce(court.jurisdiction, '')) LIKE '%bankruptcy%' THEN 'bankruptcy'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('f')
      OR (
        lower(coalesce(court.jurisdiction, '')) LIKE '%appellate%'
        AND lower(coalesce(court.jurisdiction, '')) NOT LIKE '%bankruptcy%'
      ) THEN 'appeals'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('fd', 'federal')
      OR lower(coalesce(court.jurisdiction, '')) LIKE '%district%' THEN 'district'
    ELSE 'other'
  END AS family,
  count(*) FILTER (WHERE e.filed_on >= CURRENT_DATE - 30)::int AS lines_30,
  count(*) FILTER (WHERE e.filed_on >= CURRENT_DATE - 60)::int AS lines_60,
  count(*) FILTER (WHERE e.filed_on >= CURRENT_DATE - 90)::int AS lines_90,
  count(*)::int AS lines_365
FROM docket_entry e
JOIN legal_case c ON c.id = e.case_id
JOIN court ON court.id = c.court_id
WHERE e.filed_on >= CURRENT_DATE - 365
  AND e.filed_on <= CURRENT_DATE
GROUP BY 1
ORDER BY 1;

\echo == new cases by filing window and court family
SELECT
  CASE
    WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus' THEN 'scotus'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('fb', 'fbp')
      OR lower(coalesce(court.jurisdiction, '')) LIKE '%bankruptcy%' THEN 'bankruptcy'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('f')
      OR (
        lower(coalesce(court.jurisdiction, '')) LIKE '%appellate%'
        AND lower(coalesce(court.jurisdiction, '')) NOT LIKE '%bankruptcy%'
      ) THEN 'appeals'
    WHEN lower(coalesce(court.jurisdiction, '')) IN ('fd', 'federal')
      OR lower(coalesce(court.jurisdiction, '')) LIKE '%district%' THEN 'district'
    ELSE 'other'
  END AS family,
  count(*) FILTER (WHERE c.filed_on >= CURRENT_DATE - 30)::int AS cases_30,
  count(*) FILTER (WHERE c.filed_on >= CURRENT_DATE - 60)::int AS cases_60,
  count(*) FILTER (WHERE c.filed_on >= CURRENT_DATE - 90)::int AS cases_90,
  count(*)::int AS cases_365
FROM legal_case c
JOIN court ON court.id = c.court_id
WHERE c.filed_on >= CURRENT_DATE - 365
  AND c.filed_on <= CURRENT_DATE
GROUP BY 1
ORDER BY 1;
