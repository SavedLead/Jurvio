-- Lighter one-court seed. Does not walk the courts.
--
-- The previous seed called legal_case_is_public for every row of the court,
-- including drafts, and advanced the checkpoint in that same statement. A
-- 30s timeout then continued, and the log did not name the court that failed.
--
-- seed_published_count_for_court counts one court and does not touch the
-- cursor. The shell advances published_count_seed_cursor only after that
-- call commits. A timeout leaves the cursor where it was, so the next
-- attempt retries the same court.
--
-- The count is the public rule: publication is published, and the latest
-- publication_decision for that case is displayable. Drafts are not scanned.

CREATE OR REPLACE FUNCTION seed_published_count_for_court(target uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  counted integer;
  delta_at_count integer;
BEGIN
  SELECT
    coalesce((SELECT stats.published_delta FROM court_public_stats stats WHERE stats.court_id = target), 0),
    (
      SELECT count(*)::int
      FROM legal_case c
      WHERE c.court_id = target
        AND c.publication = 'published'
        AND COALESCE((
          SELECT decision.displayable
          FROM publication_decision decision
          WHERE decision.object_type = 'legal_case'
            AND decision.object_id = c.id
          ORDER BY decision.decided_at DESC, decision.id DESC
          LIMIT 1
        ), false)
    )
  INTO delta_at_count, counted;

  PERFORM apply_published_count_seed(target, counted, delta_at_count);
  RETURN counted;
END;
$$;

-- Kept for a caller that wants one committed court. The seed script does not
-- use it, so a statement timeout cannot move the checkpoint.
CREATE OR REPLACE FUNCTION seed_next_published_count_court()
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  last_court uuid;
  next_court uuid;
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
    UPDATE published_count_seed_cursor
    SET complete = true,
        updated_at = now()
    WHERE singleton = 1;
    RETURN NULL;
  END IF;

  PERFORM seed_published_count_for_court(next_court);

  UPDATE published_count_seed_cursor
  SET court_id = next_court,
      seeded = seeded + 1,
      complete = false,
      updated_at = now()
  WHERE singleton = 1;

  RETURN next_court;
END;
$$;
