-- Visit/session ids for demand analytics. The browser holds random first-party
-- ids (jv_vid 1 year, jv_sid 30 min sliding); only salted SHA-256 hashes are
-- stored. The salt is generated here and never leaves the database.
CREATE TABLE IF NOT EXISTS demand_hash_salt (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  salt text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex')
);
INSERT INTO demand_hash_salt (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION demand_id_hash(kind text, raw text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN raw IS NULL OR raw !~ '^[A-Za-z0-9_-]{16,64}$' THEN NULL
    ELSE encode(digest((SELECT salt FROM demand_hash_salt) || ':' || kind || ':' || raw, 'sha256'), 'hex') END
$$;

-- Browser-confirmed page views (JS beacon) are the trustworthy visitor signal;
-- edge-cached pages never reach the server render, so server rows skew to crawlers.
ALTER TABLE visitor_first_touch ADD COLUMN IF NOT EXISTS visitor_hash text;
CREATE INDEX IF NOT EXISTS demand_event_beacon_idx ON demand_event (occurred_at)
  WHERE event_type = 'page_view' AND metadata->>'channel' = 'beacon';
