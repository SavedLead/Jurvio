-- Read-only: why do far fewer appeals cases get a panel than clusters carry a judges line? Aggregates + short public samples.
\set ON_ERROR_STOP 1
SET statement_timeout = '300s';
\echo '== appeals provider court ids'
SELECT court.provider_court_id, count(*) AS courts FROM court WHERE court.provider_court_id ~* '^ca' GROUP BY 1 ORDER BY 1;
\echo '== cases by publication: any cluster with judges vs latest cluster with judges'
WITH c AS (
  SELECT lc.id, lc.publication, lower(ct.provider_court_id) AS court_key,
    EXISTS (SELECT 1 FROM opinion_cluster x WHERE x.case_id = lc.id AND nullif(btrim(x.judges), '') IS NOT NULL) AS any_judges,
    (SELECT nullif(btrim(x.judges), '') IS NOT NULL FROM opinion_cluster x WHERE x.case_id = lc.id ORDER BY x.date_filed DESC NULLS LAST, x.id LIMIT 1) AS latest_judges,
    (SELECT count(*) FROM opinion_cluster x WHERE x.case_id = lc.id) AS clusters
  FROM legal_case lc JOIN court ct ON ct.id = lc.court_id AND ct.provider_court_id ~* '^ca([0-9]+|dc|fed|fc)$'
)
SELECT publication, court_key ~ '^ca([0-9]+|dc|fed)$' AS in_backfill_regex, count(*) AS cases, count(*) FILTER (WHERE clusters > 0) AS with_cluster,
  count(*) FILTER (WHERE clusters > 1) AS multi_cluster, count(*) FILTER (WHERE any_judges) AS any_judges, count(*) FILTER (WHERE latest_judges) AS latest_judges
FROM c GROUP BY 1, 2 ORDER BY 3 DESC;
\echo '== published, latest cluster judges line: shape sample (30, newest and oldest mixed)'
(SELECT ct.provider_court_id, x.date_filed, left(x.judges, 140) AS judges
 FROM legal_case lc JOIN court ct ON ct.id = lc.court_id AND ct.provider_court_id ~* '^ca([0-9]+|dc|fed)$'
 JOIN LATERAL (SELECT y.date_filed, y.judges FROM opinion_cluster y WHERE y.case_id = lc.id ORDER BY y.date_filed DESC NULLS LAST, y.id LIMIT 1) x ON true
 WHERE lc.publication = 'published' AND nullif(btrim(x.judges), '') IS NOT NULL AND lc.caption !~* '(sealed|juvenile|grand jury)'
 ORDER BY lc.id LIMIT 15)
UNION ALL
(SELECT ct.provider_court_id, x.date_filed, left(x.judges, 140)
 FROM legal_case lc JOIN court ct ON ct.id = lc.court_id AND ct.provider_court_id ~* '^ca([0-9]+|dc|fed)$'
 JOIN LATERAL (SELECT y.date_filed, y.judges FROM opinion_cluster y WHERE y.case_id = lc.id ORDER BY y.date_filed DESC NULLS LAST, y.id LIMIT 1) x ON true
 WHERE lc.publication = 'published' AND nullif(btrim(x.judges), '') IS NOT NULL AND lc.caption !~* '(sealed|juvenile|grand jury)'
 ORDER BY lc.id DESC LIMIT 15);
\echo '== judges-line length / separators in published latest clusters (sample 2%)'
SELECT count(*) AS lines, count(*) FILTER (WHERE x.judges ~ ',') AS with_comma, count(*) FILTER (WHERE x.judges ~* '\mand\M') AS with_and,
  count(*) FILTER (WHERE x.judges !~ '[,;&]' AND x.judges !~* '\mand\M') AS single_token, percentile_disc(0.5) WITHIN GROUP (ORDER BY length(x.judges)) AS median_len
FROM legal_case lc TABLESAMPLE SYSTEM (2) JOIN court ct ON ct.id = lc.court_id AND ct.provider_court_id ~* '^ca([0-9]+|dc|fed)$'
JOIN LATERAL (SELECT y.judges FROM opinion_cluster y WHERE y.case_id = lc.id ORDER BY y.date_filed DESC NULLS LAST, y.id LIMIT 1) x ON true
WHERE lc.publication = 'published' AND nullif(btrim(x.judges), '') IS NOT NULL;
