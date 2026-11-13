-- Exact federal-publication-v3 hold counts by reason list. An empty list
-- still blocks the bulk publisher. Read only.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '180s';

SELECT section, key, n
FROM (
  SELECT 'v3_hold'::text AS section,
    CASE
      WHEN cardinality(reasons) = 0 THEN '(empty)'
      ELSE array_to_string(reasons, ' + ')
    END AS key,
    count(*)::bigint AS n
  FROM federal_publication_hold
  WHERE rule_version = 'federal-publication-v3'
  GROUP BY 2
) counted
ORDER BY n DESC, key;
