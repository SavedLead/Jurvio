-- First outside user: which case they follow and how they likely found the site.
-- SELECT-only. Prints email DOMAIN only.
\echo '== (a) user, follow and case'
WITH u AS (
  SELECT id, email, created_at FROM app_user
  WHERE created_at BETWEEN '2026-11-04 19:30Z' AND '2026-11-04 20:05Z'
    AND split_part(email, '@', 2) NOT ILIKE '%jurvio.com'
    AND email NOT ILIKE '%example%' AND email NOT ILIKE '%cleanyourname%'
)
SELECT split_part(u.email, '@', 2) AS email_domain, u.created_at AS account_at,
       f.created_at AS follow_at, c.public_id, c.caption, ct.name AS court, ct.public_id AS court_id,
       c.docket_number, c.filed_on, c.terminated_on, c.nature_of_suit_code, c.cause_of_action,
       'https://jurvio.com/case/' || c.public_id AS url,
       (SELECT string_agg(t.created_at::text || ' follow=' || coalesce(t.follow_case_public_id,'-') || ' redirect=' || coalesce(t.redirect_path,'-'), ' | ')
          FROM auth_login_token t WHERE t.email = u.email) AS login_tokens
FROM u JOIN case_follow f ON f.user_id = u.id
JOIN legal_case c ON c.id = f.case_id JOIN court ct ON ct.id = c.court_id;

\echo '== (b) demand_event for that case, -3h..+1h around sign-up'
WITH u AS (
  SELECT id, created_at FROM app_user
  WHERE created_at BETWEEN '2026-11-04 19:30Z' AND '2026-11-04 20:05Z'
    AND split_part(email, '@', 2) NOT ILIKE '%jurvio.com'
    AND email NOT ILIKE '%example%' AND email NOT ILIKE '%cleanyourname%'
), fc AS (SELECT f.case_id, u.created_at FROM u JOIN case_follow f ON f.user_id = u.id)
SELECT e.occurred_at, e.event_type, e.visitor_class, e.bot_family, left(e.session_hash, 10) AS sess,
       left(e.visitor_hash, 10) AS vis, e.referrer_host, e.search_query, e.metadata
FROM demand_event e JOIN fc ON e.case_id = fc.case_id
WHERE e.occurred_at BETWEEN fc.created_at - interval '3 hours' AND fc.created_at + interval '1 hour'
ORDER BY e.occurred_at;

\echo '== (c) sessions with an event on that case within 15 min of sign-up: all their events that day'
WITH u AS (
  SELECT id, created_at FROM app_user
  WHERE created_at BETWEEN '2026-11-04 19:30Z' AND '2026-11-04 20:05Z'
    AND split_part(email, '@', 2) NOT ILIKE '%jurvio.com'
    AND email NOT ILIKE '%example%' AND email NOT ILIKE '%cleanyourname%'
), fc AS (SELECT f.case_id, u.created_at FROM u JOIN case_follow f ON f.user_id = u.id),
s AS (
  SELECT DISTINCT e.session_hash FROM demand_event e JOIN fc ON e.case_id = fc.case_id
  WHERE e.session_hash IS NOT NULL
    AND e.occurred_at BETWEEN fc.created_at - interval '15 minutes' AND fc.created_at + interval '5 minutes'
)
SELECT left(e.session_hash, 10) AS sess, e.occurred_at, e.event_type, e.visitor_class,
       c.public_id AS case_public_id, e.referrer_host, e.search_query, e.metadata
FROM demand_event e JOIN s ON s.session_hash = e.session_hash
LEFT JOIN legal_case c ON c.id = e.case_id
WHERE e.event_date = '2026-11-04'
ORDER BY e.session_hash, e.occurred_at;

\echo '== (d) non-bot referrer_host counts site-wide, Nov 3-4 (UTC dates)'
SELECT e.event_date, coalesce(e.referrer_host, '(none)') AS referrer_host, count(*) AS events,
       count(DISTINCT e.session_hash) AS sessions
FROM demand_event e
WHERE e.event_date IN ('2026-11-03', '2026-11-04')
  AND e.visitor_class::text NOT ILIKE '%bot%' AND e.bot_family IS NULL
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
