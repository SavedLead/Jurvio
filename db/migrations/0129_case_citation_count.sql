-- Case-page citation totals. Computing cited_by for one popular reporter
-- key still scanned every posting (EXPLAIN 4,849 ms after 0128). The page
-- reads this row. The citations lane refreshes it off the request path.

CREATE TABLE case_citation_count (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  cited integer NOT NULL,
  cited_on_jurvio integer NOT NULL,
  cited_by integer NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- @commit

-- Keyset for the sitemap snapshot: published cases in public_id order,
-- without a sort of every draft row.
CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_case_published_public_id_idx
  ON legal_case (public_id)
  WHERE publication = 'published';
