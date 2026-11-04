-- Read-only: sign-up and waitlist counts (no emails printed).
SELECT 'app_user' AS what,
       count(*) AS total,
       count(*) FILTER (WHERE email NOT LIKE '%@jurvio.com' AND email NOT LIKE '%example%' AND email NOT LIKE '%cleanyourname%') AS outside_people,
       count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
       min(created_at) AS first, max(created_at) AS last
FROM app_user
UNION ALL
SELECT 'lead_waitlist:' || source || coalesce(':' || plan::text, ''),
       count(*),
       count(*) FILTER (WHERE email NOT LIKE '%@jurvio.com' AND email NOT LIKE '%example%' AND email NOT LIKE '%cleanyourname%'),
       count(*) FILTER (WHERE converted_at IS NOT NULL),
       min(created_at), max(created_at)
FROM lead_waitlist GROUP BY source, plan
UNION ALL
SELECT 'plan_waitlist:' || plan::text, count(*), NULL, NULL, min(created_at), max(created_at)
FROM plan_waitlist GROUP BY plan
UNION ALL
SELECT 'case_follow', count(*), NULL, NULL, min(created_at), max(created_at) FROM case_follow
UNION ALL
SELECT 'paid_subscription:' || plan::text, count(*), NULL, NULL, min(created_at), max(created_at)
FROM account_subscription WHERE plan <> 'free' GROUP BY plan;
