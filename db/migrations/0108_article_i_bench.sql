-- Full working bench: extend the roster to the Article I judges the FJC
-- Article III directory does not cover — federal MAGISTRATE and BANKRUPTCY
-- judges. Their service terms already have a home (judge_service_term.service_type
-- already allows 'magistrate' and 'bankruptcy'); this migration adds the two
-- missing pieces:
--   1. the court_category CHECK must accept the two new branches so the control
--      center can group/filter the bench by Article III vs Article I, and
--   2. the judge row needs a stable BR/MAG identity key (the Article I analogue
--      of fjc_nid) plus an official photo, which the BR/MAG source provides.

BEGIN;

-- 1. Widen the normalized branch categories. The 0107 constraint was added as an
-- inline column CHECK with a server-generated name; drop whatever CHECK currently
-- governs court_category (robust to the auto name) and re-add the widened set.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'judge_service_term'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%court_category%'
  LOOP
    EXECUTE format('ALTER TABLE judge_service_term DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE judge_service_term
  ADD CONSTRAINT judge_service_term_court_category_check
  CHECK (court_category IN ('scotus', 'appeals', 'district', 'bankruptcy', 'magistrate', 'other'));

-- 2. Article I judge identity + likeness. brmag_id is the stable per-judge key
-- from the BR/MAG Judge Database (values like 'mag-89' / 'bnk-464'), mirroring how
-- fjc_nid anchors Article III judges. photo_url / photo_source_url hold the
-- official portrait the BR/MAG source records (Article III judges may backfill a
-- photo later from other sources).
ALTER TABLE judge
  ADD COLUMN IF NOT EXISTS brmag_id text,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_source_url text;

CREATE UNIQUE INDEX IF NOT EXISTS judge_brmag_id_uidx
  ON judge (brmag_id) WHERE brmag_id IS NOT NULL;

COMMIT;
