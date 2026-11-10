SELECT now() AS checked_at;

SELECT pid,
  usename,
  state,
  wait_event_type,
  wait_event,
  now() - xact_start AS xact_age,
  now() - query_start AS query_age,
  left(query, 400) AS query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state IS DISTINCT FROM 'idle'
ORDER BY xact_start NULLS LAST;

SELECT blocked.pid AS blocked_pid,
  blocked.wait_event_type,
  now() - blocked.query_start AS blocked_age,
  left(blocked.query, 240) AS blocked_query,
  blocking.pid AS blocking_pid,
  blocking.state AS blocking_state,
  now() - blocking.xact_start AS blocking_xact_age,
  left(blocking.query, 240) AS blocking_query
FROM pg_locks blocked_lock
JOIN pg_stat_activity blocked ON blocked.pid = blocked_lock.pid
JOIN pg_locks blocking_lock
  ON blocking_lock.locktype = blocked_lock.locktype
 AND blocking_lock.database IS NOT DISTINCT FROM blocked_lock.database
 AND blocking_lock.relation IS NOT DISTINCT FROM blocked_lock.relation
 AND blocking_lock.page IS NOT DISTINCT FROM blocked_lock.page
 AND blocking_lock.tuple IS NOT DISTINCT FROM blocked_lock.tuple
 AND blocking_lock.virtualxid IS NOT DISTINCT FROM blocked_lock.virtualxid
 AND blocking_lock.transactionid IS NOT DISTINCT FROM blocked_lock.transactionid
 AND blocking_lock.classid IS NOT DISTINCT FROM blocked_lock.classid
 AND blocking_lock.objid IS NOT DISTINCT FROM blocked_lock.objid
 AND blocking_lock.objsubid IS NOT DISTINCT FROM blocked_lock.objsubid
 AND blocking_lock.pid <> blocked_lock.pid
JOIN pg_stat_activity blocking ON blocking.pid = blocking_lock.pid
WHERE NOT blocked_lock.granted
  AND blocking_lock.granted;

SELECT a.pid,
  a.state,
  now() - a.xact_start AS xact_age,
  c.relname,
  l.mode,
  l.granted
FROM pg_stat_activity a
JOIN pg_locks l ON l.pid = a.pid
JOIN pg_class c ON c.oid = l.relation
WHERE c.relname IN ('legal_case', 'public_case_search', 'docket_entry')
  AND a.pid <> pg_backend_pid()
ORDER BY a.xact_start NULLS LAST, c.relname
LIMIT 40;
