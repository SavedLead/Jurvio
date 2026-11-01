-- Undo a Tier 1 + Tier 2 release recorded in publication_tier_release.
-- psql variables: run_id (the release run to undo), batch_size, sleep_s.
-- For each published ledger row: restore legal_case.publication to prior_publication (only if the
-- case is still 'published'), delete the publication_decision the release wrote (the delete
-- trigger recomputes publication_current), and mark the row reverted.
\set ON_ERROR_STOP on
SET statement_timeout = '3600s';
SET lock_timeout = '5s';
SELECT set_config('jurvio.tier_run_id', :'run_id', false),
       set_config('jurvio.tier_batch_size', :'batch_size', false),
       set_config('jurvio.tier_sleep_s', :'sleep_s', false) \g /dev/null
DO $$
DECLARE
  run text := current_setting('jurvio.tier_run_id');
  lim int := current_setting('jurvio.tier_batch_size')::int;
  pause double precision := current_setting('jurvio.tier_sleep_s')::double precision;
  n int;
BEGIN
  IF to_regclass('publication_tier_release') IS NULL THEN
    RAISE EXCEPTION 'publication_tier_release does not exist; nothing to undo';
  END IF;
  LOOP
    WITH batch AS (
      SELECT r.case_id, r.decision_id, r.prior_publication FROM publication_tier_release r
       WHERE r.run_id = run AND r.state = 'published'
       ORDER BY r.case_id LIMIT lim
       FOR UPDATE OF r
    ), restored AS (
      UPDATE legal_case lc SET publication = batch.prior_publication, updated_at = now()
        FROM batch WHERE lc.id = batch.case_id AND lc.publication = 'published'
      RETURNING lc.id
    ), removed AS (
      DELETE FROM publication_decision pd USING batch
       WHERE pd.id = batch.decision_id AND pd.rule_version = 'publication-tiers-v1'
      RETURNING pd.object_id
    ), ob AS (
      INSERT INTO outbox_event (topic, aggregate_type, aggregate_id, aggregate_version, payload)
      SELECT 'publication.changed', 'legal_case', batch.case_id,
             (extract(epoch FROM clock_timestamp()) * 1000000)::bigint,
             jsonb_build_object('policy', 'publication-tiers-v1', 'run_id', run, 'action', 'revert')
        FROM batch
      RETURNING 1
    ), led AS (
      UPDATE publication_tier_release r SET state = 'reverted', reverted_at = now()
        FROM batch WHERE r.case_id = batch.case_id
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM batch) INTO n;
    EXIT WHEN n = 0;
    COMMIT;
    RAISE NOTICE 'reverted batch of % at %', n, clock_timestamp();
    PERFORM pg_sleep(pause);
  END LOOP;
END $$;
\echo '--- ledger for this run (tier | state | cases) ---'
SELECT tier, state, count(*) FROM publication_tier_release
 WHERE run_id = current_setting('jurvio.tier_run_id') GROUP BY 1, 2 ORDER BY 1, 2;
