-- One public Supreme Court row.
--
-- The courts directory listed two "Supreme Court of the United States" rows.
-- Cases move onto the row whose provider_court_id is scotus, except a docket
-- number that court already has. The published-case counter moves with them.
-- The other public id stays in court_public_redirect so /courts/<old> redirects
-- instead of 404. The duplicate court row stays so existing foreign keys hold.

CREATE TABLE IF NOT EXISTS court_public_redirect (
  public_id text PRIMARY KEY,
  target_public_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (public_id <> target_public_id)
);

-- @commit

DO $$
DECLARE
  canonical uuid;
  canonical_public text;
BEGIN
  SELECT court.id, court.public_id
  INTO canonical, canonical_public
  FROM court
  LEFT JOIN court_public_stats stats ON stats.court_id = court.id
  WHERE lower(coalesce(court.provider_court_id, '')) = 'scotus'
     OR lower(court.name) IN (
       'supreme court of the united states',
       'u.s. supreme court',
       'supreme court of the us'
     )
  ORDER BY CASE WHEN lower(coalesce(court.provider_court_id, '')) = 'scotus' THEN 0 ELSE 1 END,
    coalesce(stats.case_count, 0) DESC,
    court.updated_at DESC
  LIMIT 1;

  IF canonical IS NULL THEN
    RETURN;
  END IF;

  UPDATE court AS canonical_row
  SET provider_court_id = 'scotus', updated_at = now()
  WHERE canonical_row.id = canonical
    AND lower(coalesce(canonical_row.provider_court_id, '')) <> 'scotus'
    AND NOT EXISTS (
      SELECT 1 FROM court other
      WHERE other.id <> canonical_row.id
        AND other.provider_id IS NOT DISTINCT FROM canonical_row.provider_id
        AND lower(coalesce(other.provider_court_id, '')) = 'scotus'
    );

  INSERT INTO court_public_redirect (public_id, target_public_id)
  SELECT court.public_id, canonical_public
  FROM court
  WHERE court.id <> canonical
    AND court.public_id <> canonical_public
    AND (
      lower(coalesce(court.provider_court_id, '')) = 'scotus'
      OR lower(court.name) IN (
        'supreme court of the united states',
        'u.s. supreme court',
        'supreme court of the us'
      )
    )
  ON CONFLICT (public_id) DO UPDATE SET target_public_id = EXCLUDED.target_public_id;

  UPDATE legal_case dup
  SET court_id = canonical, updated_at = now()
  WHERE dup.court_id IN (
      SELECT id FROM court WHERE public_id IN (SELECT public_id FROM court_public_redirect)
    )
    AND NOT EXISTS (
      SELECT 1 FROM legal_case keep
      WHERE keep.court_id = canonical
        AND lower(keep.docket_number) = lower(dup.docket_number)
    );

  IF to_regclass('opinion_search_meta') IS NOT NULL THEN
    UPDATE opinion_search_meta meta
    SET court_id = canonical
    FROM legal_case lc
    WHERE meta.case_id = lc.id
      AND lc.court_id = canonical
      AND meta.court_id IS DISTINCT FROM canonical;
  END IF;

  IF to_regclass('opinion_search_projection') IS NOT NULL THEN
    UPDATE opinion_search_projection projection
    SET court_id = canonical
    WHERE projection.case_id IN (SELECT id FROM legal_case WHERE court_id = canonical)
      AND projection.court_id IS DISTINCT FROM canonical;
  END IF;
END $$;
