-- Read-only recon: why district pages with an FJC IDB match don't name a winner.
\pset format unaligned
\pset fieldsep ' | '
\pset footer off

\echo '=== A. FJC rows by publication state and which case dates we hold'
SELECT c.publication,
  COALESCE((SELECT cur.displayable FROM publication_current cur WHERE cur.object_type = 'legal_case' AND cur.object_id = c.id), false) AS displayable,
  (c.filed_on IS NOT NULL) AS has_filed_on, (c.terminated_on IS NOT NULL) AS has_terminated_on,
  (SELECT t.tier::text FROM publication_tier_release t WHERE t.case_id = c.id AND t.state = 'published' ORDER BY t.tier LIMIT 1) AS tier,
  count(*)
FROM fjc_idb_case_outcome f JOIN legal_case c ON c.id = f.case_id
GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC;

\echo '=== B. disposition x judgment-for (published only)'
SELECT f.disposition_code, f.judgment_code, count(*)
FROM fjc_idb_case_outcome f JOIN legal_case c ON c.id = f.case_id AND c.publication = 'published'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30;

\echo '=== C. examples: published, judgment disposition with judgment for plaintiff/defendant'
SELECT c.public_id, left(c.caption, 80) AS caption, c.filed_on, c.terminated_on, f.date_terminated, f.disposition_code, f.judgment_code,
  left(f.plaintiff, 40) AS plaintiff, left(f.defendant, 40) AS defendant
FROM fjc_idb_case_outcome f JOIN legal_case c ON c.id = f.case_id AND c.publication = 'published'
WHERE f.disposition_code IN (4, 5, 6, 7, 8, 9, 15) AND f.judgment_code IN (1, 2, 3)
  AND COALESCE((SELECT cur.displayable FROM publication_current cur WHERE cur.object_type = 'legal_case' AND cur.object_id = c.id), false)
ORDER BY (c.filed_on IS NULL), f.date_terminated DESC NULLS LAST LIMIT 12;
