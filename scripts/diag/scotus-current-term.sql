-- Read-only SCOTUS inventory scoped to the scotus court and the emergency tables.
-- Not a full legal_case scan: every case count joins the scotus court row.
SELECT 'court' AS what, count(*)::int AS n, NULL::text AS detail
FROM court WHERE lower(provider_court_id) = 'scotus'
UNION ALL
SELECT 'published_cases', count(*)::int, NULL
FROM legal_case c JOIN court ct ON ct.id = c.court_id
WHERE lower(ct.provider_court_id) = 'scotus' AND c.publication = 'published'
UNION ALL
SELECT 'draft_cases', count(*)::int, NULL
FROM legal_case c JOIN court ct ON ct.id = c.court_id
WHERE lower(ct.provider_court_id) = 'scotus' AND c.publication = 'draft'
UNION ALL
SELECT 'published_opinion_docs', count(*)::int, NULL
FROM document d
JOIN legal_case c ON c.id = d.case_id
JOIN court ct ON ct.id = c.court_id
JOIN judicial_opinion j ON j.document_id = d.id
WHERE lower(ct.provider_court_id) = 'scotus' AND d.publication = 'published'
UNION ALL
SELECT 'published_opinion_with_text', count(*)::int, NULL
FROM document d
JOIN legal_case c ON c.id = d.case_id
JOIN court ct ON ct.id = c.court_id
JOIN judicial_opinion j ON j.document_id = d.id
JOIN document_content content ON content.document_id = d.id
WHERE lower(ct.provider_court_id) = 'scotus'
  AND d.publication = 'published'
  AND content.content_text ~ '\S';

SELECT CASE
         WHEN c.docket_number ~ '^26A[0-9]+$' THEN 'application'
         WHEN c.docket_number ~ '^26-[5-9][0-9]{3}$' THEN 'ifp'
         WHEN c.docket_number ~ '^26-[0-9]+$' THEN 'paid'
         ELSE 'other'
       END AS series,
       c.publication::text,
       count(*)::int AS n
FROM legal_case c JOIN court ct ON ct.id = c.court_id
WHERE lower(ct.provider_court_id) = 'scotus'
  AND (c.docket_number LIKE '26-%' OR c.docket_number LIKE '26A%')
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT docket_number, publication::text, decided_on, filed_on
FROM legal_case c JOIN court ct ON ct.id = c.court_id
WHERE lower(ct.provider_court_id) = 'scotus'
  AND docket_number IN ('26-600', '26-6092', '26A660', '26A476')
ORDER BY docket_number;

SELECT source_lane, count(*)::int AS n,
       count(*) FILTER (WHERE kind = 'extension')::int AS extensions,
       count(*) FILTER (WHERE kind <> 'extension' AND status = 'pending')::int AS pending_serious
FROM scotus_application
GROUP BY source_lane
ORDER BY source_lane;

SELECT term, complete, highest_number, pages, scanned_at
FROM scotus_emergency_history_coverage
ORDER BY term;

SELECT administration, count(*)::int AS serious
FROM scotus_application
WHERE kind <> 'extension' AND applicant_kind = 'federal' AND administration IS NOT NULL
GROUP BY administration
ORDER BY administration;
