BEGIN;

-- District RSS capability audit, 2026-10-30: every district registered in
-- 0097 was requested once at its PACER public RSS URL (rss_outside.pl).
-- These 67 returned an XML feed with entries, in addition to the 12 already
-- enabled. The other 15 (alnd, flnd, gand, gasd, kyed, mdd, msnd, ndd, nyed,
-- nywd, oked, oknd, pamd, vaed, wvsd) answered with an empty body and stay off.
-- ingest-direct-court-feeds rotates through enabled courts, least recently
-- retrieved first, a bounded number per run, so enabling more courts does not
-- raise the per-run cost.
UPDATE direct_court_registry SET
  rss_available = true,
  rss_coverage_hours = COALESCE(rss_coverage_hours, 24),
  included_event_categories = CASE WHEN included_event_categories = '[]'::jsonb THEN '["all"]'::jsonb ELSE included_event_categories END,
  updated_at = now()
WHERE court_type = 'district'
  AND rss_available = false
  AND court_code IN ('akd','almd','alsd','ared','arwd','azd','caed','cod','ctd','flmd','gamd','gud','hid','iand','iasd','idd','ilcd','ilnd','ilsd','innd','insd','ksd','kywd','laed','lamd','lawd','med','mied','miwd','mnd','moed','mowd','mssd','mtd','nced','ncmd','ncwd','ned','nhd','nmd','nmid','nvd','nynd','ohnd','ohsd','okwd','ord','paed','pawd','prd','rid','scd','sdd','tned','tnmd','tnwd','txnd','txsd','utd','vawd','vid','vtd','waed','wied','wiwd','wvnd','wyd');

COMMIT;
