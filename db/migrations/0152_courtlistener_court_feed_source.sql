BEGIN;

-- CourtListener per-court opinion Atom feeds (public, no API token) for the
-- districts with no public PACER RSS and no GovInfo packages: gasd, msnd,
-- oknd, vaed. The feed job writes court_source_watermark rows with source
-- 'courtlistener_feed'; court_fetch_log and free_source_item have no source
-- constraint.
ALTER TABLE court_source_watermark DROP CONSTRAINT IF EXISTS court_source_watermark_source_check;
ALTER TABLE court_source_watermark ADD CONSTRAINT court_source_watermark_source_check CHECK (source = ANY (ARRAY[
  'bulk', 'scotus_official', 'coa_feed', 'district_rss', 'courtlistener',
  'appellate_official', 'govinfo', 'court_site', 'appellate_pacer_rss', 'courtlistener_feed'
]::text[]));

COMMIT;
