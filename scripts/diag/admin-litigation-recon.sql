-- Administration-litigation recon (read-only). Sizes the candidate set of
-- cases naming the United States, the President, federal agencies or cabinet
-- officials, filed since 2025-01-20, by court level; and how many have judge
-- links, NOS codes, docket entries and documents.
\timing on
\echo '== candidates by court level and rule (filed_on >= 2025-01-20)'
WITH c AS (
  SELECT lc.id, lc.publication, lc.nature_of_suit_code, lc.caption,
    CASE WHEN lower(court.provider_court_id)='scotus' THEN 'scotus'
         WHEN court.provider_court_id ~ '^ca([0-9]+|dc|fed|fc)$' THEN 'appeals'
         WHEN court.jurisdiction IN ('FD','Federal District') THEN 'district' ELSE 'other' END AS kind,
    court.provider_court_id AS court
  FROM legal_case lc JOIN court ON court.id = lc.court_id
  WHERE lc.filed_on >= DATE '2025-01-20'
), t AS (
  SELECT c.*,
    (caption ~* '\m(trump|vance)\M') AS r_president,
    (caption ~* '(\mUnited States\M|\mU\.\s?S\.\s?A?\.?\s|\mUSA\M)') AS r_us,
    (caption ~* '(department of (homeland security|justice|state|defense|war|education|labor|health|agriculture|commerce|energy|the interior|interior|transportation|treasury|veterans|housing)|office of personnel management|\mOPM\M|office of management and budget|\mOMB\M|immigration and customs|\mICE\M|customs and border|\mCBP\M|\mUSCIS\M|citizenship and immigration|health and human services|\mHHS\M|national institutes of health|\mNIH\M|\mUSAID\M|agency for international development|social security administration|environmental protection agency|\mFEMA\M|government efficiency|\mDOGE\M|federal trade commission|national labor relations board|merit systems protection|general services administration|\mGSA\M|national science foundation|consumer financial protection|\mCFPB\M|internal revenue service|department of government|executive office of the president)') AS r_agency,
    (caption ~* '\m(noem|bondi|rubio|hegseth|bessent|vought|kennedy,? jr|lutnick|rollins|mcmahon|chavez-deremer|duffy|burgum|wright|turner|collins|ezell|kupor|lyons|musk|patel|blanche|sauer|zeldin|bisignano|dudek|marocco)\M') AS r_official
  FROM c
)
SELECT kind,
  count(*) AS filed_since_jan20,
  count(*) FILTER (WHERE r_president OR r_us OR r_agency OR r_official) AS any_rule,
  count(*) FILTER (WHERE r_president) AS president,
  count(*) FILTER (WHERE r_us) AS united_states,
  count(*) FILTER (WHERE r_agency) AS agency,
  count(*) FILTER (WHERE r_official) AS official,
  count(*) FILTER (WHERE (r_president OR r_us OR r_agency OR r_official) AND publication='published') AS any_published,
  count(*) FILTER (WHERE (r_president OR r_us OR r_agency OR r_official) AND nature_of_suit_code IS NOT NULL) AS any_with_nos
FROM t GROUP BY 1 ORDER BY 1;

\echo '== admin-candidate district cases: top courts (president/agency/official rules only, excludes bare United States)'
WITH c AS (
  SELECT lc.id, court.provider_court_id AS court, lc.caption, lc.nature_of_suit_code
  FROM legal_case lc JOIN court ON court.id = lc.court_id
  WHERE lc.filed_on >= DATE '2025-01-20' AND court.jurisdiction IN ('FD','Federal District')
    AND (lc.caption ~* '\m(trump|noem|bondi|rubio|hegseth|bessent|vought|lutnick|mcmahon|musk|kennedy,? jr)\M'
      OR lc.caption ~* '(department of homeland security|office of personnel management|immigration and customs|health and human services|national institutes of health|\mUSAID\M|government efficiency|\mDOGE\M|department of education|executive office of the president|office of management and budget)')
)
SELECT court, count(*) n, count(*) FILTER (WHERE caption ~* '\m(noem|immigration and customs|homeland security)\M' ) AS immigration_named,
  count(nature_of_suit_code) with_nos
FROM c GROUP BY 1 ORDER BY 2 DESC LIMIT 25;

\echo '== NOS mix among admin-candidate district cases'
SELECT lc.nature_of_suit_code, count(*) FROM legal_case lc JOIN court ON court.id=lc.court_id
WHERE lc.filed_on >= DATE '2025-01-20' AND court.jurisdiction IN ('FD','Federal District') AND lc.nature_of_suit_code IS NOT NULL
  AND (lc.caption ~* '\m(trump|noem|bondi|rubio|hegseth|bessent|vought|lutnick|mcmahon|musk)\M' OR lc.caption ~* '(department of|office of personnel management|immigration and customs|health and human services|government efficiency)')
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

\echo '== depth on admin-candidate cases by level: judge links, docket entries, documents'
WITH a AS (
  SELECT lc.id,
    CASE WHEN lower(court.provider_court_id)='scotus' THEN 'scotus'
         WHEN court.provider_court_id ~ '^ca([0-9]+|dc|fed|fc)$' THEN 'appeals'
         WHEN court.jurisdiction IN ('FD','Federal District') THEN 'district' ELSE 'other' END AS kind
  FROM legal_case lc JOIN court ON court.id = lc.court_id
  WHERE lc.filed_on >= DATE '2025-01-20'
    AND (lc.caption ~* '\m(trump|noem|bondi|rubio|hegseth|bessent|vought|lutnick|mcmahon|musk)\M'
      OR lc.caption ~* '(department of (homeland security|justice|state|defense|war|education|labor|health|agriculture|commerce|energy|the interior|transportation|treasury|veterans|housing)|office of personnel management|immigration and customs|health and human services|national institutes of health|\mUSAID\M|government efficiency|executive office of the president|office of management and budget)')
)
SELECT kind, count(*) cases,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM judge_case_assignment j WHERE j.case_id=a.id)) AS with_judge_assignment,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM appeals_panel_seat s WHERE s.case_id=a.id AND s.judge_id IS NOT NULL)) AS with_panel_seat,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id=a.id)) AS with_entries,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id=a.id AND e.created_at > now() - interval '14 days')) AS entries_last_14d,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM document d WHERE d.case_id=a.id)) AS with_documents
FROM a GROUP BY 1 ORDER BY 1;

\echo '== SCOTUS emergency applications (A dockets) filed since 2025-01-20'
SELECT count(*) AS a_dockets,
  count(*) FILTER (WHERE lc.caption ~* '(\mtrump\M|united states|department of|noem|bondi|rubio|hegseth|bessent|vought|mcmahon|office of personnel|national institutes)') AS a_dockets_admin_named,
  count(*) FILTER (WHERE lc.publication='published') AS published
FROM legal_case lc JOIN court ON court.id = lc.court_id
WHERE lower(court.provider_court_id)='scotus' AND lc.docket_number ~ '^[0-9]{2}A[0-9]+$' AND (lc.filed_on >= DATE '2025-01-20' OR lc.docket_number ~ '^(25|26)A');

\echo '== sample published admin-candidate captions (precision check)'
SELECT court.provider_court_id, lc.docket_number, left(lc.caption, 110) AS caption
FROM legal_case lc JOIN court ON court.id = lc.court_id
WHERE lc.publication='published' AND lc.filed_on >= DATE '2025-01-20'
  AND (lc.caption ~* '\m(trump|vought|mcmahon|musk)\M' OR lc.caption ~* '(office of personnel management|government efficiency|national institutes of health)')
ORDER BY lc.filed_on DESC LIMIT 25;

\echo '== FJC IDB coverage (possible NOS source)'
SELECT count(*) AS idb_rows, count(case_id) AS idb_linked FROM fjc_idb_case_outcome;
SELECT column_name FROM information_schema.columns WHERE table_name='fjc_idb_case_outcome' ORDER BY ordinal_position;
