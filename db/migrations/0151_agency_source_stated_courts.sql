BEGIN;

-- District courts an agency item names even when it states no docket number
-- (state AG releases often say "filed in the U.S. District Court for the District
-- of Connecticut" without a number). Context for the review queue only: an item
-- still links to a case only through a stated court + docket reference.
ALTER TABLE agency_source_item ADD COLUMN IF NOT EXISTS stated_courts text[] NOT NULL DEFAULT '{}';

COMMIT;
