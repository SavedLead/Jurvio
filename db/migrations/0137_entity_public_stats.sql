-- Precomputed party / law-firm directory counts (ADR 0082).
--
-- /parties and /law-firms run count(DISTINCT legal_case.id) over every
-- party_appearance of every published case, with two correlated publication
-- lookups per row, on every request (no cache). Today the entity gate keeps
-- that small (~0.08 s), but party_appearance grows with every bulk docket load
-- and opening the party gate turns it into a full join over millions of rows.
--
-- The `public-directory-stats` job accumulates per-entity counts one keyset
-- batch of published cases at a time into a new generation, then publishes the
-- generation in public_stats_generation. Each case is visited once per pass, so
-- summing per-batch count(DISTINCT case) is exact. Readers use the published
-- generation only, and fall back to the live query when there is none.

CREATE TABLE IF NOT EXISTS entity_public_stats (
  generation integer NOT NULL,
  entity_id uuid NOT NULL,
  case_count integer NOT NULL CHECK (case_count >= 0),
  latest_case_date date,
  PRIMARY KEY (generation, entity_id)
);

CREATE INDEX IF NOT EXISTS entity_public_stats_rank_idx
  ON entity_public_stats (generation, case_count DESC, entity_id);

CREATE TABLE IF NOT EXISTS public_stats_generation (
  name text PRIMARY KEY,
  -- Generation readers use. NULL until the first pass completes.
  published_generation integer,
  published_at timestamptz,
  -- Pass in progress: generation number and legal_case.public_id keyset cursor.
  building_generation integer,
  building_cursor text,
  building_started_at timestamptz
);

INSERT INTO public_stats_generation (name) VALUES ('entity') ON CONFLICT (name) DO NOTHING;
