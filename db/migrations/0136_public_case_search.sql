-- Precomputed text-search candidates for /cases?q=, &party= and &firm= (ADR 0081).
--
-- A free-text /cases search took 4.1-4.7 s on every request (never cached, by
-- design). The text condition ORs caption, docket and citation ILIKE with EXISTS
-- over scotus_case_enrichment and party_appearance/entity, so no trigram index
-- can drive it and Postgres walks the published slice of a 16M-row legal_case.
--
-- public_case_search keeps one narrow row per published case: caption, docket,
-- citation, verified holding and every party/entity name, joined with newlines.
-- Its trigram index yields a superset of candidate ids. The listing query still
-- applies the exact original conditions and the live publication gate to those
-- candidates, so results never include anything the live query would not.
--
-- The citations-lane job `public-case-search` fills it in committed keyset
-- batches. Readers only use it after one full sweep has completed
-- (public_case_search_state.sweep_completed_at), so a half-filled table can
-- never hide results. No trigger and no foreign key is added to legal_case or
-- party_appearance, so bulk loads are not slowed.
--
-- Both tables are new; the GIN index is built on an empty table.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public_case_search (
  case_id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  search_text text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_case_search_text_trgm_idx
  ON public_case_search USING gin (search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public_case_search_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  -- Keyset position (legal_case.public_id) of the rolling full sweep.
  sweep_cursor text,
  sweep_started_at timestamptz,
  -- Set when a full sweep last reached the end. NULL means "not ready": readers use the live query.
  sweep_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public_case_search_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
