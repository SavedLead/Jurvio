-- Precomputed sitemap XML. Public requests read one row by primary key.
-- They must not number or count the live corpus; that work timed out at the
-- 20s web statement limit and returned HTTP 500 for /sitemap.xml.
-- The citations-lane job refreshes these rows. A failed refresh leaves the
-- previous body in place.

CREATE TABLE sitemap_document (
  kind text NOT NULL,
  page_number integer NOT NULL CHECK (page_number >= 0),
  body text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, page_number)
);
