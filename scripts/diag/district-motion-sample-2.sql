-- Read-only: like district-motion-sample.sql, but counts only docket entries the public site shows
-- (latest publication decision displayable for both the case and the entry).
\echo == displayable docket entries by court kind (published cases)
SELECT ct.jurisdiction, count(*) AS entries, count(DISTINCT de.case_id) AS cases
FROM docket_entry de
JOIN legal_case lc ON lc.id = de.case_id AND lc.publication = 'published'
JOIN court ct ON ct.id = lc.court_id
WHERE COALESCE((SELECT d.displayable FROM publication_decision d WHERE d.object_type = 'docket_entry' AND d.object_id = de.id ORDER BY d.decided_at DESC, d.id DESC LIMIT 1), false)
GROUP BY 1 ORDER BY 2 DESC;

\echo == district/bankruptcy cases with >= 2 displayable MOTION entries (sample of 15)
SELECT lc.public_id, ct.provider_court_id, count(*) AS motion_entries
FROM docket_entry de
JOIN legal_case lc ON lc.id = de.case_id AND lc.publication = 'published'
JOIN court ct ON ct.id = lc.court_id AND ct.jurisdiction IN ('FD', 'Federal District', 'FB')
WHERE de.description ~* '\mMOTION\M'
  AND COALESCE((SELECT d.displayable FROM publication_decision d WHERE d.object_type = 'docket_entry' AND d.object_id = de.id ORDER BY d.decided_at DESC, d.id DESC LIMIT 1), false)
GROUP BY 1, 2 HAVING count(*) >= 2
ORDER BY random() LIMIT 15;

\echo == open cases with a displayable entry (last 90 days) that sets a date (sample of 15)
SELECT lc.public_id, ct.provider_court_id, max(de.filed_on) AS latest
FROM docket_entry de
JOIN legal_case lc ON lc.id = de.case_id AND lc.publication = 'published' AND lc.terminated_on IS NULL
JOIN court ct ON ct.id = lc.court_id
WHERE de.filed_on > current_date - 90
  AND de.description ~* '(set|scheduled|reset|due)\s+(for|by|on)\s'
  AND COALESCE((SELECT d.displayable FROM publication_decision d WHERE d.object_type = 'docket_entry' AND d.object_id = de.id ORDER BY d.decided_at DESC, d.id DESC LIMIT 1), false)
GROUP BY 1, 2 ORDER BY random() LIMIT 15;
