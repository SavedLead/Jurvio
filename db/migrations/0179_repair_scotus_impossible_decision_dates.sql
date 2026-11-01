-- Repair Supreme Court decision dates with an impossible year (front-end audit,
-- 2026-11-01). Some official/LOC candidates carried a mistyped century, e.g.
-- Kansas v. Colorado, 206 U.S. 46 (jv-qhduj4l6pl), decided 1907-05-13 but
-- stored as 1007-05-13, which also left supreme_court_term at 2006.
--
-- Bounded and safe:
--   * only SCOTUS rows (supreme_court_term IS NOT NULL, partial index from
--     0109) whose decided_on is before 1789 -- impossible for a federal court;
--   * the fix keeps month, day and the last two digits of the year and picks
--     the century from the official U.S. Reports volume (approximate year by
--     interpolating known volume/year anchors); the repaired year must be
--     within 6 years of that estimate and between 1790 and this year, or the
--     row is left as is (reported via NOTICE);
--   * the same bad date on the case's documents, docket entries, opinion
--     clusters and source candidates is rewritten so republishing cannot
--     reintroduce it; updated_at is left alone.

CREATE TEMP TABLE scotus_date_repair ON COMMIT DROP AS
WITH anchors(volume, year) AS (
  VALUES (1, 1790), (5, 1801), (14, 1816), (42, 1843), (60, 1857), (100, 1879),
         (150, 1893), (200, 1905), (250, 1919), (300, 1937), (350, 1955),
         (400, 1971), (450, 1980), (500, 1991), (550, 2007), (600, 2023)
), bad AS (
  SELECT id, decided_on AS old_date, official_citation,
    substring(official_citation FROM '^\s*(\d+)\s+U\.\s?S\.')::int AS volume
  FROM legal_case
  WHERE supreme_court_term IS NOT NULL
    AND decided_on < DATE '1789-01-01'
), estimated AS (
  SELECT bad.*,
    (SELECT lo.year + (hi.year - lo.year) * (bad.volume - lo.volume)::numeric / NULLIF(hi.volume - lo.volume, 0)
     FROM anchors lo, anchors hi
     WHERE lo.volume <= bad.volume AND hi.volume > bad.volume
       AND hi.volume = (SELECT min(volume) FROM anchors WHERE volume > bad.volume)
       AND lo.volume = (SELECT max(volume) FROM anchors WHERE volume <= bad.volume)) AS est_year
  FROM bad
), candidates AS (
  SELECT e.id, e.old_date, e.est_year,
    make_date(c.century + (extract(year FROM e.old_date)::int % 100),
              extract(month FROM e.old_date)::int,
              extract(day FROM e.old_date)::int) AS new_date
  FROM estimated e
  CROSS JOIN (VALUES (1700), (1800), (1900), (2000)) AS c(century)
  WHERE e.est_year IS NOT NULL
    AND NOT (extract(month FROM e.old_date) = 2 AND extract(day FROM e.old_date) = 29)
)
SELECT id, old_date, new_date,
  (extract(year FROM new_date)::int - CASE WHEN extract(month FROM new_date) >= 10 THEN 0 ELSE 1 END)::smallint AS new_term
FROM candidates
WHERE abs(extract(year FROM new_date) - est_year) <= 6
  AND extract(year FROM new_date) BETWEEN 1790 AND extract(year FROM now());

-- An ambiguous match (two centuries within the window) is never applied.
DELETE FROM scotus_date_repair r
WHERE (SELECT count(*) FROM scotus_date_repair o WHERE o.id = r.id) > 1;

DO $$
DECLARE
  bad_count int;
  fix_count int;
BEGIN
  SELECT count(*) INTO bad_count FROM legal_case
  WHERE supreme_court_term IS NOT NULL AND decided_on < DATE '1789-01-01';
  SELECT count(*) INTO fix_count FROM scotus_date_repair;
  IF fix_count > 500 THEN
    RAISE EXCEPTION 'scotus date repair would touch % cases; refusing (bounded repair)', fix_count;
  END IF;
  RAISE NOTICE 'scotus impossible decided_on: % found, % repaired, % left as is', bad_count, fix_count, bad_count - fix_count;
END $$;

UPDATE document d SET filed_on = r.new_date
FROM scotus_date_repair r
WHERE d.case_id = r.id AND d.filed_on = r.old_date;

UPDATE docket_entry e SET filed_on = r.new_date
FROM scotus_date_repair r
WHERE e.case_id = r.id AND e.filed_on = r.old_date;

UPDATE opinion_cluster oc SET date_filed = r.new_date
FROM scotus_date_repair r
WHERE oc.case_id = r.id AND oc.date_filed = r.old_date;

UPDATE official_opinion_candidate cand SET filed_on = r.new_date
FROM scotus_date_repair r
JOIN legal_case c ON c.id = r.id
WHERE cand.filed_on = r.old_date
  AND cand.citation IS NOT DISTINCT FROM c.official_citation
  AND lower(regexp_replace(cand.docket_number, '[^a-zA-Z0-9]', '', 'g'))
    = lower(regexp_replace(c.docket_number, '[^a-zA-Z0-9]', '', 'g'));

UPDATE legal_case c
SET decided_on = r.new_date,
    filed_on = CASE WHEN c.filed_on = r.old_date THEN r.new_date ELSE c.filed_on END,
    supreme_court_term = r.new_term
FROM scotus_date_repair r
WHERE c.id = r.id;
