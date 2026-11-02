-- Read-only: which Supreme Court docket years Jurvio holds, and justice-note coverage per year.
\echo '== SCOTUS cases held vs docket status vs justice notes, by docket year (2-digit prefix)'
WITH sc AS (
  SELECT c.id, c.docket_number, c.supreme_court_term,
    CASE WHEN c.docket_number ~ '^[0-9]{2}[-A]' THEN substr(c.docket_number, 1, 2) ELSE 'other' END AS yy
  FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus'
  WHERE c.publication = 'published'
)
SELECT sc.yy, count(*) AS cases_held,
  count(s.case_id) AS with_docket_status,
  count(s.case_id) FILTER (WHERE s.cert_status = 'denied') AS denied,
  count(DISTINCT n.case_id) FILTER (WHERE s.cert_status = 'denied') AS denied_with_public_position,
  min(sc.supreme_court_term) AS min_term, max(sc.supreme_court_term) AS max_term
FROM sc
LEFT JOIN scotus_docket_status s ON s.case_id = sc.id
LEFT JOIN scotus_docket_justice_note n ON n.case_id = sc.id AND n.entry_context = 'cert_denied' AND n.note_kind <> 'recused'
GROUP BY sc.yy ORDER BY sc.yy;
\echo '== earliest and latest docketed/cert dates in docket status'
SELECT min(cert_status_on), max(cert_status_on), count(*) FROM scotus_docket_status;
\echo '== denied cases with a public position, listed'
SELECT s.docket_number, c.public_id, s.cert_status_on, string_agg(DISTINCT n.note_kind || ':' || n.justice_ref, ', ') AS notes
FROM scotus_docket_justice_note n JOIN scotus_docket_status s ON s.case_id = n.case_id AND s.cert_status = 'denied'
JOIN legal_case c ON c.id = n.case_id
WHERE n.entry_context = 'cert_denied' AND n.note_kind <> 'recused'
GROUP BY 1,2,3 ORDER BY 3 DESC LIMIT 60;
