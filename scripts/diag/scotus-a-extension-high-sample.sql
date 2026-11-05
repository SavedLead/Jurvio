-- Read-only: A-docket application grants that look like time extensions still marked high
-- (should go to 0 after the #699 reclassify apply). Each statement repeats its CTE
-- (psql runs them separately; a CTE does not survive across statements).
WITH cand AS (
  SELECT c.docket_number, e.entry_type, e.importance, left(e.description, 160) AS line,
    row_number() OVER (ORDER BY e.id) AS rn,
    count(*) OVER () AS total
  FROM docket_entry e
  JOIN legal_case c ON c.id = e.case_id
  JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
  WHERE e.entry_type = 'application_granted' AND e.importance = 'high'
    AND btrim(c.docket_number) ~* '^\d{2}A\d{1,5}$'
    AND e.description ~* '(to\s+extend\s+the\s+time|extension\s+of\s+(the\s+)?time|extend(ing)?\s+the\s+time|enlargement\s+of\s+time)'
)
SELECT coalesce((SELECT total FROM cand LIMIT 1), 0) AS a_extension_still_high;

WITH cand AS (
  SELECT c.docket_number, e.entry_type, e.importance, left(e.description, 160) AS line,
    row_number() OVER (ORDER BY e.id) AS rn,
    count(*) OVER () AS total
  FROM docket_entry e
  JOIN legal_case c ON c.id = e.case_id
  JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
  WHERE e.entry_type = 'application_granted' AND e.importance = 'high'
    AND btrim(c.docket_number) ~* '^\d{2}A\d{1,5}$'
    AND e.description ~* '(to\s+extend\s+the\s+time|extension\s+of\s+(the\s+)?time|extend(ing)?\s+the\s+time|enlargement\s+of\s+time)'
)
SELECT docket_number, entry_type, importance, line
FROM cand
WHERE rn IN (
  1,
  greatest(1, (total * 1 / 10)),
  greatest(1, (total * 2 / 10)),
  greatest(1, (total * 3 / 10)),
  greatest(1, (total * 4 / 10)),
  greatest(1, (total * 5 / 10)),
  greatest(1, (total * 6 / 10)),
  greatest(1, (total * 7 / 10)),
  greatest(1, (total * 8 / 10)),
  greatest(1, (total * 9 / 10))
)
ORDER BY rn
LIMIT 10;
