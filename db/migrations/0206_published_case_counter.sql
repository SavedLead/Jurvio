-- Running published-case counter.
--
-- /cases and /coverage sum court_public_stats.case_count. That used to be a
-- recount of every court every half hour, so the headline sat still while
-- publish was still committing. A statement-level trigger now adds the rows
-- that became published and subtracts the rows that left, in the same
-- transaction, including a bulk UPDATE. The already-running bulk script does
-- not know about the counter; the trigger sees its publication change.
--
-- published_base is the seeded count. published_delta is everything the
-- trigger has applied. case_count is base + delta, which is what readers use.
-- The directory refresh must not write case_count.

ALTER TABLE court_public_stats
  ADD COLUMN IF NOT EXISTS published_base integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_delta integer NOT NULL DEFAULT 0;

-- @commit

CREATE OR REPLACE FUNCTION sync_court_published_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO court_public_stats AS stats (court_id, case_count, published_base, published_delta, recent_case_ids)
    SELECT court_id, count(*)::int, 0, count(*)::int, '{}'::uuid[]
    FROM new_rows
    WHERE publication = 'published'
    GROUP BY court_id
    ON CONFLICT (court_id) DO UPDATE SET
      published_delta = stats.published_delta + EXCLUDED.published_delta,
      case_count = stats.case_count + EXCLUDED.case_count;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE court_public_stats AS stats
    SET published_delta = stats.published_delta - removed.n,
        case_count = GREATEST(0, stats.case_count - removed.n)
    FROM (
      SELECT court_id, count(*)::int AS n
      FROM old_rows
      WHERE publication = 'published'
      GROUP BY court_id
    ) AS removed
    WHERE stats.court_id = removed.court_id;
  ELSE
    INSERT INTO court_public_stats AS stats (court_id, case_count, published_base, published_delta, recent_case_ids)
    SELECT court_id, delta, 0, delta, '{}'::uuid[]
    FROM (
      SELECT court_id, sum(change)::int AS delta
      FROM (
        SELECT court_id, -1 AS change FROM old_rows WHERE publication = 'published'
        UNION ALL
        SELECT court_id, 1 FROM new_rows WHERE publication = 'published'
      ) AS moved
      GROUP BY court_id
      HAVING sum(change) > 0
    ) AS gained
    ON CONFLICT (court_id) DO UPDATE SET
      published_delta = stats.published_delta + EXCLUDED.published_delta,
      case_count = stats.case_count + EXCLUDED.case_count;

    UPDATE court_public_stats AS stats
    SET published_delta = stats.published_delta + lost.delta,
        case_count = GREATEST(0, stats.case_count + lost.delta)
    FROM (
      SELECT court_id, sum(change)::int AS delta
      FROM (
        SELECT court_id, -1 AS change FROM old_rows WHERE publication = 'published'
        UNION ALL
        SELECT court_id, 1 FROM new_rows WHERE publication = 'published'
      ) AS moved
      GROUP BY court_id
      HAVING sum(change) < 0
    ) AS lost
    WHERE stats.court_id = lost.court_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS court_published_count_insert ON legal_case;
CREATE TRIGGER court_published_count_insert
  AFTER INSERT ON legal_case
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_court_published_count();

DROP TRIGGER IF EXISTS court_published_count_delete ON legal_case;
CREATE TRIGGER court_published_count_delete
  AFTER DELETE ON legal_case
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_court_published_count();

DROP TRIGGER IF EXISTS court_published_count_update ON legal_case;
CREATE TRIGGER court_published_count_update
  AFTER UPDATE OF publication, court_id ON legal_case
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_court_published_count();

-- @commit

-- One court at a time, in its own transaction, so a count does not hold a
-- lock across the bulk job's publish statement. The count uses the published
-- browse index (court_id WHERE publication = published) and only takes the
-- counter row lock for the final assignment. Publishes that commit during the
-- count stay in published_delta and are added back, so they are not lost and
-- not counted twice. A row the bulk job is still holding is skipped and
-- remains the previous total plus the trigger's deltas.
CREATE OR REPLACE PROCEDURE seed_court_published_counts()
LANGUAGE plpgsql AS $$
DECLARE
  courts uuid[];
  court uuid;
  counted integer;
  delta_at_count integer;
  attempt integer;
  seeded boolean;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO courts FROM court;
  COMMIT;
  FOREACH court IN ARRAY courts LOOP
    SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
    PERFORM set_config('statement_timeout', '0', true);
    SELECT coalesce(published_delta, 0) INTO delta_at_count
    FROM court_public_stats WHERE court_id = court;
    IF NOT FOUND THEN
      delta_at_count := 0;
    END IF;
    SELECT count(*)::int INTO counted
    FROM legal_case
    WHERE court_id = court AND publication = 'published';
    COMMIT;

    seeded := false;
    FOR attempt IN 1..5 LOOP
      BEGIN
        PERFORM set_config('lock_timeout', '2s', true);
        UPDATE court_public_stats
        SET published_base = counted - delta_at_count,
            case_count = GREATEST(0, (counted - delta_at_count) + published_delta)
        WHERE court_id = court;
        IF NOT FOUND AND counted <> 0 THEN
          INSERT INTO court_public_stats (court_id, case_count, published_base, published_delta, recent_case_ids)
          VALUES (court, counted, counted, 0, '{}');
        END IF;
        seeded := true;
        EXIT;
      EXCEPTION WHEN lock_not_available OR query_canceled THEN
        PERFORM pg_sleep(1);
      END;
    END LOOP;
    IF NOT seeded THEN
      RAISE NOTICE 'published counter seed skipped court % because the counter row was busy', court;
    END IF;
    COMMIT;
  END LOOP;
END;
$$;

CALL seed_court_published_counts();
