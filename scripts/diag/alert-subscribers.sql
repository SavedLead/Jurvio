-- Read-only subscriber counts. No addresses are selected.
-- Staff and test accounts (jurvio.com, example, cleanyourname) are excluded.

SELECT count(*)::int AS subscribers,
       count(*) FILTER (WHERE tier = 'free')::int AS free,
       count(*) FILTER (WHERE tier = 'paid')::int AS paid
FROM (
  SELECT CASE WHEN s.plan IN ('plus', 'pro', 'team') AND s.status IN ('active', 'trialing', 'past_due') THEN 'paid' ELSE 'free' END AS tier
  FROM app_user u
  LEFT JOIN account_subscription s ON s.user_id = u.id
  WHERE u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
    AND (
      EXISTS (SELECT 1 FROM case_follow f WHERE f.user_id = u.id)
      OR EXISTS (SELECT 1 FROM entity_follow f WHERE f.user_id = u.id)
    )
) subscribers;

SELECT 'case' AS follow_type, count(*)::int AS follows, count(DISTINCT f.user_id)::int AS subscribers
FROM case_follow f JOIN app_user u ON u.id = f.user_id
WHERE u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
UNION ALL
SELECT f.kind, count(*)::int, count(DISTINCT f.user_id)::int
FROM entity_follow f JOIN app_user u ON u.id = f.user_id
WHERE u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
GROUP BY f.kind
ORDER BY 1;

SELECT f.target_key AS feed, count(*)::int AS follows
FROM entity_follow f JOIN app_user u ON u.id = f.user_id
WHERE f.kind = 'emergency'
  AND u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
GROUP BY f.target_key ORDER BY follows DESC, feed;

SELECT c.public_id, left(c.caption, 80) AS caption, c.docket_number, count(*)::int AS follows
FROM case_follow f
JOIN legal_case c ON c.id = f.case_id
JOIN app_user u ON u.id = f.user_id
WHERE u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
GROUP BY c.public_id, c.caption, c.docket_number
ORDER BY follows DESC, c.public_id
LIMIT 15;

SELECT coalesce(nullif(f.label, ''), f.target_key) AS label, count(*)::int AS follows
FROM entity_follow f JOIN app_user u ON u.id = f.user_id
WHERE f.kind = 'judge'
  AND u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
GROUP BY 1 ORDER BY follows DESC, label LIMIT 15;

SELECT coalesce(nullif(f.label, ''), f.target_key) AS label, count(*)::int AS follows
FROM entity_follow f JOIN app_user u ON u.id = f.user_id
WHERE f.kind = 'topic'
  AND u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
GROUP BY 1 ORDER BY follows DESC, label LIMIT 15;

SELECT coalesce(nullif(f.label, ''), f.target_key) AS label, count(*)::int AS follows
FROM entity_follow f JOIN app_user u ON u.id = f.user_id
WHERE f.kind = 'party'
  AND u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'
GROUP BY 1 ORDER BY follows DESC, label LIMIT 15;
