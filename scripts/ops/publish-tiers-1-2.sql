-- Tier 1 + Tier 2 release (David Rosenberg, 2026-10-30: "Publish only Tiers 1 and 2 for now").
-- psql variables: run_id, expected_t1, expected_t2, tolerance (fraction, e.g. 0.02),
--                 batch_size, sleep_s, apply ('true' publishes; anything else = dry run).
-- Never touches Tier 3/4, already-published cases, restricted/sealed/soft-held cases, or any
-- environment flag. Every case it publishes is recorded in publication_tier_release first.
\set ON_ERROR_STOP on
SET statement_timeout = '3600s';
SET lock_timeout = '5s';
SET work_mem = '64MB';
SELECT set_config('jurvio.tier_run_id', :'run_id', false),
       set_config('jurvio.tier_batch_size', :'batch_size', false),
       set_config('jurvio.tier_sleep_s', :'sleep_s', false),
       set_config('jurvio.tier_expected_t1', :'expected_t1', false),
       set_config('jurvio.tier_expected_t2', :'expected_t2', false),
       set_config('jurvio.tier_tolerance', :'tolerance', false) \g /dev/null

\i /tmp/tiers-1-2-candidates.sql

-- Abort (non-zero exit) when either tier is more than `tolerance` away from the diagnostic.
DO $$
DECLARE
  t1 bigint := (SELECT count(*) FROM tier_candidate WHERE gate = 'ok' AND tier = 1);
  t2 bigint := (SELECT count(*) FROM tier_candidate WHERE gate = 'ok' AND tier = 2);
  e1 numeric := current_setting('jurvio.tier_expected_t1')::numeric;
  e2 numeric := current_setting('jurvio.tier_expected_t2')::numeric;
  tol numeric := current_setting('jurvio.tier_tolerance')::numeric;
BEGIN
  RAISE NOTICE 'tier1 publishable % (expected %), tier2 publishable % (expected %), tolerance %', t1, e1, t2, e2, tol;
  IF e1 <= 0 OR e2 <= 0 OR abs(t1 - e1) / e1 > tol OR abs(t2 - e2) / e2 > tol THEN
    RAISE EXCEPTION 'TOLERANCE_ABORT: tier1 % vs %, tier2 % vs % (tolerance %)', t1, e1, t2, e2, tol;
  END IF;
  RAISE NOTICE 'TOLERANCE_OK';
END $$;

SELECT (:'apply' = 'true') AS do_apply \gset
\if :do_apply
\echo '--- APPLY: staging ledger then publishing in batches ---'
CREATE TABLE IF NOT EXISTS publication_tier_release (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 4),
  run_id text NOT NULL,
  prior_publication publication_state NOT NULL,
  decision_id uuid,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'skipped', 'reverted')),
  skip_reason text,
  staged_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS publication_tier_release_run_state_idx
  ON publication_tier_release (run_id, state, tier);

-- Stage. A case already published by an earlier run is left alone; reverted/skipped rows are re-staged.
INSERT INTO publication_tier_release (case_id, tier, run_id, prior_publication)
SELECT id, tier, current_setting('jurvio.tier_run_id'), 'draft'
  FROM tier_candidate WHERE gate = 'ok' AND tier IN (1, 2)
ON CONFLICT (case_id) DO UPDATE
   SET tier = EXCLUDED.tier, run_id = EXCLUDED.run_id, state = 'pending', decision_id = NULL,
       skip_reason = NULL, staged_at = now(), published_at = NULL, reverted_at = NULL
 WHERE publication_tier_release.state IN ('reverted', 'skipped');

-- Publish in committed batches. Each batch re-checks, under row locks, that the case is
-- still a draft and not conflict/needs_review; anything that changed is marked skipped.
DO $$
DECLARE
  run text := current_setting('jurvio.tier_run_id');
  lim int := current_setting('jurvio.tier_batch_size')::int;
  pause double precision := current_setting('jurvio.tier_sleep_s')::double precision;
  n int;
  done_total int := 0;
BEGIN
  LOOP
    WITH batch AS (
      SELECT r.case_id, r.tier FROM publication_tier_release r
       WHERE r.run_id = run AND r.state = 'pending'
       ORDER BY r.tier, r.case_id
       LIMIT lim
    ), locked AS (
      SELECT lc.id, batch.tier FROM legal_case lc JOIN batch ON batch.case_id = lc.id
       WHERE lc.publication = 'draft' AND lc.verification NOT IN ('conflict', 'needs_review')
       FOR UPDATE OF lc SKIP LOCKED
    ), upd AS (
      UPDATE legal_case lc SET publication = 'published', updated_at = now()
        FROM locked WHERE lc.id = locked.id
      RETURNING lc.id
    ), dec AS (
      INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible,
                                        downloadable, summary_eligible, reason_code, rule_version)
      SELECT 'legal_case', locked.id, true, true, true, false, false,
             'tier' || locked.tier || '_release', 'publication-tiers-v1'
        FROM upd JOIN locked ON locked.id = upd.id
      RETURNING id, object_id
    ), ob AS (
      INSERT INTO outbox_event (topic, aggregate_type, aggregate_id, aggregate_version, payload)
      SELECT 'publication.changed', 'legal_case', dec.object_id,
             (extract(epoch FROM clock_timestamp()) * 1000000)::bigint,
             jsonb_build_object('policy', 'publication-tiers-v1', 'run_id', run)
        FROM dec
      RETURNING 1
    ), led AS (
      UPDATE publication_tier_release r SET state = 'published', decision_id = dec.id, published_at = now()
        FROM dec WHERE r.case_id = dec.object_id
      RETURNING 1
    ), skipped AS (
      UPDATE publication_tier_release r SET state = 'skipped', skip_reason = 'changed_or_locked_at_publish'
        FROM batch
       WHERE r.case_id = batch.case_id AND NOT EXISTS (SELECT 1 FROM locked WHERE locked.id = batch.case_id)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM batch) INTO n;
    EXIT WHEN n = 0;
    done_total := done_total + n;
    COMMIT;
    RAISE NOTICE 'batch committed: % rows (% total) at %', n, done_total, clock_timestamp();
    PERFORM pg_sleep(pause);
  END LOOP;
END $$;
\endif

\echo '--- legal_case by publication ---'
SELECT publication, count(*) FROM legal_case GROUP BY 1 ORDER BY 1;
SELECT to_regclass('publication_tier_release') IS NOT NULL AS has_ledger \gset
\if :has_ledger
\echo '--- ledger for this run (tier | state | cases) ---'
SELECT tier, state, count(*) FROM publication_tier_release
 WHERE run_id = current_setting('jurvio.tier_run_id') GROUP BY 1, 2 ORDER BY 1, 2;
\echo '--- spot-check sample (tier | public_id | in_publication_current | indexable) ---'
SELECT r.tier, lc.public_id, (pc.object_id IS NOT NULL), pd.indexable
  FROM (SELECT * FROM publication_tier_release WHERE run_id = current_setting('jurvio.tier_run_id') AND state = 'published'
         ORDER BY tier, published_at DESC LIMIT 1000) r
  JOIN legal_case lc ON lc.id = r.case_id
  LEFT JOIN publication_current pc ON pc.object_type = 'legal_case' AND pc.object_id = r.case_id
  LEFT JOIN publication_decision pd ON pd.id = pc.decision_id
 ORDER BY r.tier, md5(lc.public_id) LIMIT 6;
\endif
