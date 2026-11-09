-- Read-only. 2017-now supremecourt.gov backfill checkpoint. No row text.
SELECT lane, cursor->>'year' AS year, cursor->>'series' AS series, cursor->>'next' AS next,
       cursor->>'complete' AS complete, cursor->'counts' AS counts,
       cursor->'orders' AS orders, cursor->'slips' AS slips, updated_at
FROM scotus_official_checkpoint
WHERE lane = 'dockets-2017';

SELECT term_year, count(*)::int AS slip_rows FROM scotus_slip_index GROUP BY 1 ORDER BY 1;

SELECT term_year, count(*)::int AS order_lists,
       count(*) FILTER (WHERE pdf_sha256 IS NULL)::int AS index_only
FROM scotus_order_list GROUP BY 1 ORDER BY 1;

SELECT count(*)::int AS filing_links, count(*) FILTER (WHERE content_sha256 IS NOT NULL)::int AS with_checksum
FROM scotus_filing_link;

SELECT count(*)::int AS counsel_rows FROM scotus_counsel;
