-- Running published-case counter.
--
-- /cases and /coverage sum court_public_stats.case_count. A case counts only
-- when the public displayable rule counts it: publication is published and
-- the latest publication_decision for that case is displayable. A sealed
-- draft is not published and gets no displayable decision, so it never
-- increments. A later decision that sets displayable false, or a publication
-- change off published, decrements in that same statement.
--
-- The trigger aggregates by court and writes a counter row only when that
-- court's net is not zero. Date and search updates do not change publication
-- or the decision, so they take no counter row lock.
--
-- published_base is the seeded count. published_delta is everything the
-- trigger has applied. case_count is base + delta, which is what readers use.
-- The directory refresh must not write case_count.
--
-- This migration does not walk the courts. That count is the separate
-- resumable seed job, so a deploy is recorded as soon as these triggers exist.

ALTER TABLE court_public_stats
  ADD COLUMN IF NOT EXISTS published_base integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_delta integer NOT NULL DEFAULT 0;

-- @commit

-- Same predicate as the public case list: published, and the latest
-- publication_decision.displayable is true. No decision means not displayable.
CREATE OR REPLACE FUNCTION legal_case_is_public(case_id uuid, case_publication publication_state)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN case_publication IS DISTINCT FROM 'published' THEN false
    ELSE COALESCE((
      SELECT decision.displayable
      FROM publication_decision decision
      WHERE decision.object_type = 'legal_case'
        AND decision.object_id = case_id
      ORDER BY decision.decided_at DESC, decision.id DESC
      LIMIT 1
    ), false)
  END;
$$;

-- One write for the courts whose net changed. A zero delta never reaches the
-- counter table, so it takes no row lock.
CREATE OR REPLACE FUNCTION apply_court_published_deltas(court_ids uuid[], deltas integer[])
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM unnest(court_ids, deltas) AS d(court_id, delta) WHERE d.delta <> 0
  ) THEN
    RETURN;
  END IF;
  INSERT INTO court_public_stats AS stats (court_id, case_count, published_base, published_delta, recent_case_ids)
  SELECT d.court_id, GREATEST(d.delta, 0), 0, d.delta, '{}'::uuid[]
  FROM unnest(court_ids, deltas) AS d(court_id, delta)
  WHERE d.delta <> 0
    AND (d.delta > 0 OR EXISTS (
      SELECT 1 FROM court_public_stats existing WHERE existing.court_id = d.court_id
    ))
  ON CONFLICT (court_id) DO UPDATE SET
    published_delta = stats.published_delta + EXCLUDED.published_delta,
    case_count = GREATEST(0, stats.case_count + EXCLUDED.published_delta);
END;
$$;

CREATE OR REPLACE FUNCTION sync_court_published_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  court_ids uuid[];
  deltas integer[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(array_agg(gained.court_id), '{}'), coalesce(array_agg(gained.delta), '{}')
    INTO court_ids, deltas
    FROM (
      SELECT court_id, count(*)::int AS delta
      FROM new_rows
      WHERE legal_case_is_public(id, publication)
      GROUP BY court_id
    ) AS gained;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT coalesce(array_agg(removed.court_id), '{}'), coalesce(array_agg(removed.delta), '{}')
    INTO court_ids, deltas
    FROM (
      SELECT court_id, -count(*)::int AS delta
      FROM old_rows
      WHERE legal_case_is_public(id, publication)
      GROUP BY court_id
    ) AS removed;
  ELSE
    -- Date, search, and other updates leave publication and court_id alone.
    -- Return before any counter write so those statements take no row lock
    -- on the court rows a bulk publish is holding.
    IF NOT EXISTS (
      SELECT 1
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.publication IS DISTINCT FROM o.publication
         OR n.court_id IS DISTINCT FROM o.court_id
    ) THEN
      RETURN NULL;
    END IF;

    SELECT coalesce(array_agg(changed.court_id), '{}'), coalesce(array_agg(changed.delta), '{}')
    INTO court_ids, deltas
    FROM (
      SELECT court_id, sum(change)::int AS delta
      FROM (
        SELECT o.court_id, -1 AS change
        FROM old_rows o
        JOIN new_rows n ON n.id = o.id
        WHERE legal_case_is_public(o.id, o.publication)
          AND (n.publication IS DISTINCT FROM o.publication OR n.court_id IS DISTINCT FROM o.court_id)
        UNION ALL
        SELECT n.court_id, 1
        FROM new_rows n
        JOIN old_rows o ON o.id = n.id
        WHERE legal_case_is_public(n.id, n.publication)
          AND (n.publication IS DISTINCT FROM o.publication OR n.court_id IS DISTINCT FROM o.court_id)
      ) AS moved
      GROUP BY court_id
      HAVING sum(change) <> 0
    ) AS changed;
  END IF;
  PERFORM apply_court_published_deltas(court_ids, deltas);
  RETURN NULL;
END;
$$;

-- A new or replaced decision can make a published case displayable, or stop
-- it being displayable, without changing legal_case.publication. Aggregate
-- first and skip a court whose latest displayable flag did not change.
CREATE OR REPLACE FUNCTION sync_published_count_on_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  court_ids uuid[];
  deltas integer[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM old_rows WHERE object_type = 'legal_case') THEN
      RETURN NULL;
    END IF;
    SELECT coalesce(array_agg(changed.court_id), '{}'), coalesce(array_agg(changed.delta), '{}')
    INTO court_ids, deltas
    FROM (
      SELECT c.court_id,
        sum(
          (c.publication = 'published' AND coalesce(new_flag.displayable, false))::int
          - (c.publication = 'published' AND coalesce(old_flag.displayable, false))::int
        )::int AS delta
      FROM (SELECT DISTINCT object_id FROM old_rows WHERE object_type = 'legal_case') AS affected
      JOIN legal_case c ON c.id = affected.object_id
      LEFT JOIN LATERAL (
        SELECT d.displayable
        FROM publication_decision d
        WHERE d.object_type = 'legal_case' AND d.object_id = affected.object_id
        ORDER BY d.decided_at DESC, d.id DESC
        LIMIT 1
      ) AS new_flag ON true
      LEFT JOIN LATERAL (
        SELECT d.displayable
        FROM (
          SELECT id, displayable, decided_at
          FROM publication_decision
          WHERE object_type = 'legal_case' AND object_id = affected.object_id
          UNION ALL
          SELECT id, displayable, decided_at
          FROM old_rows
          WHERE object_type = 'legal_case' AND object_id = affected.object_id
        ) AS d
        ORDER BY d.decided_at DESC, d.id DESC
        LIMIT 1
      ) AS old_flag ON true
      GROUP BY c.court_id
      HAVING sum(
        (c.publication = 'published' AND coalesce(new_flag.displayable, false))::int
        - (c.publication = 'published' AND coalesce(old_flag.displayable, false))::int
      ) <> 0
    ) AS changed;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT EXISTS (SELECT 1 FROM new_rows WHERE object_type = 'legal_case') THEN
      RETURN NULL;
    END IF;
    SELECT coalesce(array_agg(changed.court_id), '{}'), coalesce(array_agg(changed.delta), '{}')
    INTO court_ids, deltas
    FROM (
      SELECT c.court_id,
        sum(
          (c.publication = 'published' AND coalesce(new_flag.displayable, false))::int
          - (c.publication = 'published' AND coalesce(old_flag.displayable, false))::int
        )::int AS delta
      FROM (SELECT DISTINCT object_id FROM new_rows WHERE object_type = 'legal_case') AS affected
      JOIN legal_case c ON c.id = affected.object_id
      LEFT JOIN LATERAL (
        SELECT d.displayable
        FROM publication_decision d
        WHERE d.object_type = 'legal_case' AND d.object_id = affected.object_id
        ORDER BY d.decided_at DESC, d.id DESC
        LIMIT 1
      ) AS new_flag ON true
      LEFT JOIN LATERAL (
        SELECT d.displayable
        FROM (
          SELECT id, displayable, decided_at
          FROM publication_decision
          WHERE object_type = 'legal_case'
            AND object_id = affected.object_id
            AND id NOT IN (SELECT id FROM new_rows)
          UNION ALL
          SELECT id, displayable, decided_at
          FROM old_rows
          WHERE object_type = 'legal_case' AND object_id = affected.object_id
        ) AS d
        ORDER BY d.decided_at DESC, d.id DESC
        LIMIT 1
      ) AS old_flag ON true
      GROUP BY c.court_id
      HAVING sum(
        (c.publication = 'published' AND coalesce(new_flag.displayable, false))::int
        - (c.publication = 'published' AND coalesce(old_flag.displayable, false))::int
      ) <> 0
    ) AS changed;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM new_rows WHERE object_type = 'legal_case') THEN
      RETURN NULL;
    END IF;
    SELECT coalesce(array_agg(changed.court_id), '{}'), coalesce(array_agg(changed.delta), '{}')
    INTO court_ids, deltas
    FROM (
      SELECT c.court_id,
        sum(
          (c.publication = 'published' AND coalesce(new_flag.displayable, false))::int
          - (c.publication = 'published' AND coalesce(old_flag.displayable, false))::int
        )::int AS delta
      FROM (SELECT DISTINCT object_id FROM new_rows WHERE object_type = 'legal_case') AS affected
      JOIN legal_case c ON c.id = affected.object_id
      LEFT JOIN LATERAL (
        SELECT d.displayable
        FROM publication_decision d
        WHERE d.object_type = 'legal_case' AND d.object_id = affected.object_id
        ORDER BY d.decided_at DESC, d.id DESC
        LIMIT 1
      ) AS new_flag ON true
      LEFT JOIN LATERAL (
        SELECT d.displayable
        FROM publication_decision d
        WHERE d.object_type = 'legal_case'
          AND d.object_id = affected.object_id
          AND d.id NOT IN (SELECT id FROM new_rows)
        ORDER BY d.decided_at DESC, d.id DESC
        LIMIT 1
      ) AS old_flag ON true
      GROUP BY c.court_id
      HAVING sum(
        (c.publication = 'published' AND coalesce(new_flag.displayable, false))::int
        - (c.publication = 'published' AND coalesce(old_flag.displayable, false))::int
      ) <> 0
    ) AS changed;
  END IF;
  PERFORM apply_court_published_deltas(court_ids, deltas);
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

-- PostgreSQL rejects transition tables on a trigger that names columns, so
-- this trigger runs for every update. The function returns before touching
-- court_public_stats unless publication or court_id changed, and then writes
-- one aggregated row per court whose net is not zero.
DROP TRIGGER IF EXISTS court_published_count_update ON legal_case;
CREATE TRIGGER court_published_count_update
  AFTER UPDATE ON legal_case
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_court_published_count();

DROP TRIGGER IF EXISTS court_published_count_decision_insert ON publication_decision;
CREATE TRIGGER court_published_count_decision_insert
  AFTER INSERT ON publication_decision
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_published_count_on_decision();

DROP TRIGGER IF EXISTS court_published_count_decision_update ON publication_decision;
CREATE TRIGGER court_published_count_decision_update
  AFTER UPDATE ON publication_decision
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_published_count_on_decision();

DROP TRIGGER IF EXISTS court_published_count_decision_delete ON publication_decision;
CREATE TRIGGER court_published_count_decision_delete
  AFTER DELETE ON publication_decision
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_published_count_on_decision();

-- @commit

-- Replace case_count from a fresh displayable count. Do not add that count to
-- the row that is already there: the live trigger may already have added its
-- publishes to both case_count and published_delta. Subtract the delta from
-- the snapshot and add back the delta at write time, so those publishes stay
-- counted once. A second seed of the same court produces the same total.
CREATE OR REPLACE FUNCTION apply_published_count_seed(court uuid, counted integer, delta_at_count integer)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE court_public_stats
  SET published_base = counted - delta_at_count,
      case_count = GREATEST(0, (counted - delta_at_count) + published_delta)
  WHERE court_id = court;
  IF NOT FOUND AND counted <> 0 THEN
    INSERT INTO court_public_stats (court_id, case_count, published_base, published_delta, recent_case_ids)
    VALUES (court, counted, counted, 0, '{}');
  END IF;
END;
$$;

-- The resumable seed records the last court it committed. A court the partial
-- in-deploy seed already wrote is reconciled when this job reaches it: the
-- formula replaces case_count, it does not add to it.
CREATE TABLE IF NOT EXISTS published_count_seed_cursor (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  court_id uuid,
  seeded integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO published_count_seed_cursor (singleton) VALUES (1) ON CONFLICT DO NOTHING;

-- The earlier migration attempt created a procedure that walks every court
-- inside the deploy. Drop it so the deploy cannot call it.
DROP PROCEDURE IF EXISTS seed_court_published_counts();

-- One court. The caller commits. The checkpoint moves in the same transaction
-- as the counter write, so a timeout leaves both unchanged.
CREATE OR REPLACE FUNCTION seed_next_published_count_court()
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  last_court uuid;
  next_court uuid;
  counted integer;
  delta_at_count integer;
BEGIN
  SELECT court_id INTO last_court
  FROM published_count_seed_cursor
  WHERE singleton = 1;

  SELECT id INTO next_court
  FROM court
  WHERE id > coalesce(last_court, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- One statement, so the stored delta and the displayable count share a snapshot.
  SELECT
    coalesce((SELECT published_delta FROM court_public_stats WHERE court_id = next_court), 0),
    (SELECT count(*)::int FROM legal_case
      WHERE court_id = next_court AND legal_case_is_public(id, publication))
  INTO delta_at_count, counted;

  PERFORM apply_published_count_seed(next_court, counted, delta_at_count);

  UPDATE published_count_seed_cursor
  SET court_id = next_court,
      seeded = seeded + 1,
      updated_at = now()
  WHERE singleton = 1;

  RETURN next_court;
END;
$$;
