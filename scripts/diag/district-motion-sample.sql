-- Read-only: published district/bankruptcy cases whose docket has several motion entries (to verify the motions section live).
\echo == published district cases with most MOTION docket entries (sample of 20)
SELECT lc.public_id, ct.provider_court_id, count(*) AS motion_entries
FROM docket_entry de
JOIN legal_case lc ON lc.id = de.case_id AND lc.publication = 'published'
JOIN court ct ON ct.id = lc.court_id AND ct.jurisdiction IN ('FD', 'Federal District', 'FB')
WHERE de.description ~* '\mMOTION\M'
GROUP BY 1, 2 HAVING count(*) >= 3
ORDER BY random() LIMIT 20;
