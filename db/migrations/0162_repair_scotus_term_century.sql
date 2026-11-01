-- Repair Supreme Court terms written with a fixed 20xx century (front-end
-- audit, 2026-11-01). publish-official-scotus-opinions expanded the official
-- two-digit term as 2000 + yy, so bound-volume / LOC opinions got terms like
-- 2065 (Miranda v. Arizona, decided 1966-06-13, is the 1965 Term). The code now
-- takes the century from the decision date; this fixes rows already written.
--
-- A term is wrong when it is later than the decision year or more than two
-- years before it. The October Term is the decision year when decided in
-- October-December, otherwise the year before. Rows with no date only get
-- 100 years removed when the term is in the future. Only SCOTUS rows carry a
-- term (supreme_court_term IS NOT NULL), which the partial index from 0109
-- covers, so this does not scan all of legal_case. updated_at is left alone so
-- the repair does not flood "recently updated" lists.

WITH dated AS (
  SELECT id, supreme_court_term AS term, COALESCE(decided_on, filed_on) AS on_date
  FROM legal_case
  WHERE supreme_court_term IS NOT NULL
)
UPDATE legal_case c
SET supreme_court_term = CASE
    WHEN d.on_date IS NOT NULL THEN extract(year FROM d.on_date)::int - CASE WHEN extract(month FROM d.on_date) >= 10 THEN 0 ELSE 1 END
    ELSE d.term - 100
  END
FROM dated d
WHERE c.id = d.id
  AND (
    (d.on_date IS NOT NULL AND (d.term > extract(year FROM d.on_date)::int OR d.term < extract(year FROM d.on_date)::int - 2))
    OR (d.on_date IS NULL AND d.term > extract(year FROM now())::int + 1)
  );
