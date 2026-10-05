-- Let the public /cases search match official citations (e.g. "603 U.S. 369")
-- with the same trigram contains-matching already indexed for captions, docket
-- numbers, and party names in 0113. Only published cases with a citation are
-- indexed, which keeps the index small.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS legal_case_official_citation_search_trgm_idx
  ON legal_case USING gin (official_citation gin_trgm_ops)
  WHERE publication = 'published' AND official_citation IS NOT NULL;
