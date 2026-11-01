-- Read-only recon for "Where this case stands" v2 (citation precision + data sources).
\pset format unaligned
\pset fieldsep ' | '
\pset footer off

\echo '=== A. citation identities for the three spot-check cases'
SELECT c.public_id, c.caption, i.citation_key, i.citation_label,
  (SELECT count(*) FROM case_citation_identity o WHERE o.citation_key = i.citation_key) AS cases_sharing_key,
  (SELECT count(*) FROM document_case_citation r WHERE r.citation_key = i.citation_key) AS refs
FROM legal_case c JOIN case_citation_identity i ON i.case_id = c.id
WHERE c.public_id IN ('jv-s53fb7vdoj', 'jv-psa0531m28', 'jv-n77naroa4h')
ORDER BY 1, 3;

\echo '=== A2. stored counts'
SELECT c.public_id, s.* FROM legal_case c JOIN case_citation_count s ON s.case_id = c.id
WHERE c.public_id IN ('jv-s53fb7vdoj', 'jv-psa0531m28', 'jv-n77naroa4h');

\echo '=== A3. other Jurvio cases sharing the same caption words (possible duplicates)'
SELECT c.public_id, c.caption, c.docket_number, c.publication, i.citation_key
FROM legal_case c JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
LEFT JOIN case_citation_identity i ON i.case_id = c.id
WHERE (c.caption ILIKE 'Miranda v%Arizona%' OR c.caption ILIKE 'Brown v%Board of Education%' OR c.caption ILIKE '%Briggs%Elliott%' OR c.caption ILIKE 'Celotex%Catrett%')
ORDER BY 2, 1;

\echo '=== A4. 30 random citing references per case, with the text around the match (one per citing case)'
WITH target AS (
  SELECT c.id, c.public_id, c.caption FROM legal_case c
  WHERE c.public_id IN ('jv-s53fb7vdoj', 'jv-psa0531m28', 'jv-n77naroa4h')
), keys AS (
  SELECT t.public_id, t.caption, i.citation_key FROM target t JOIN case_citation_identity i ON i.case_id = t.id
  WHERE (SELECT count(*) FROM case_citation_identity o WHERE o.citation_key = i.citation_key) = 1
), refs AS (
  SELECT DISTINCT ON (k.public_id, d.case_id) k.public_id AS target, r.citation_label, d.case_id AS citing_case, d.id AS document_id,
    r.start_offset, r.end_offset, content.content_text
  FROM keys k
  JOIN document_case_citation r ON r.citation_key = k.citation_key AND r.location_kind = 'text'
  JOIN document d ON d.id = r.document_id AND d.publication = 'published'
  JOIN document_content content ON content.document_id = d.id AND content.content_hash = r.source_content_hash
  ORDER BY k.public_id, d.case_id, r.start_offset
), sampled AS (
  SELECT *, row_number() OVER (PARTITION BY target ORDER BY md5(citing_case::text || 'v2')) AS n,
    count(*) OVER (PARTITION BY target) AS citing_cases
  FROM refs
)
SELECT s.target, s.citing_cases, s.n, citing.public_id AS citing_id, court.provider_court_id AS citing_court,
  left(citing.caption, 70) AS citing_caption, s.citation_label,
  regexp_replace(substr(s.content_text, greatest(1, s.start_offset - 260), 260), '\s+', ' ', 'g') AS before_text,
  '[[' || regexp_replace(substr(s.content_text, s.start_offset + 1, s.end_offset - s.start_offset), '\s+', ' ', 'g') || ']]' AS matched,
  regexp_replace(substr(s.content_text, s.end_offset + 1, 60), '\s+', ' ', 'g') AS after_text
FROM sampled s JOIN legal_case citing ON citing.id = s.citing_case JOIN court ON court.id = citing.court_id
WHERE s.n <= 30
ORDER BY s.target, s.n;

\echo '=== B. party_appearance roles on published cases by court type (sample-free counts)'
SELECT CASE WHEN lower(court.provider_court_id) = 'scotus' THEN 'supreme'
            WHEN lower(court.provider_court_id) ~ '^ca[0-9]+$|^cadc$|^cafc$' THEN 'appellate'
            WHEN court.jurisdiction = 'FD' THEN 'district' ELSE coalesce(court.jurisdiction, '?') END AS kind,
  p.role, count(*) AS appearances, count(DISTINCT p.case_id) AS cases
FROM party_appearance p JOIN legal_case c ON c.id = p.case_id AND c.publication = 'published'
JOIN court ON court.id = c.court_id
GROUP BY 1, 2 ORDER BY 1, 4 DESC;

\echo '=== C. district/published: terminated, has docket entries, has party appearances'
SELECT court.jurisdiction, count(*) AS cases,
  count(*) FILTER (WHERE c.terminated_on IS NOT NULL) AS terminated,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = c.id)) AS with_entries,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = c.id)) AS with_parties,
  count(*) FILTER (WHERE c.judgment_state <> 'none') AS judgment_state_set,
  count(*) FILTER (WHERE c.disposition_scope <> 'none') AS disposition_set
FROM legal_case c JOIN court ON court.id = c.court_id
WHERE c.publication = 'published' AND court.jurisdiction IN ('FD', 'FB', 'F', 'FS')
GROUP BY 1 ORDER BY 1;

\echo '=== C2. FJC IDB import checkpoints'
SELECT * FROM fjc_idb_import_checkpoint ORDER BY snapshot_date DESC, filing_year LIMIT 80;

\echo '=== C3. docket identifiers that could link to FJC / CourtListener'
SELECT identifier_type, count(*) FROM case_identifier GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

\echo '=== D. Supreme Court published cases: decided_on, enrichment, tier, docket number shape'
SELECT (SELECT t.tier FROM publication_tier_release t WHERE t.case_id = c.id AND t.state = 'published' LIMIT 1) AS tier,
  c.decided_on IS NULL AS no_decided, e.case_id IS NOT NULL AS has_enrichment, e.verification::text AS enr_verif,
  CASE WHEN c.docket_number ~ '^[0-9]{2}-[0-9]+$' THEN 'YY-N' WHEN c.docket_number ~ '^[0-9]{2}A[0-9]+$' THEN 'YYA' WHEN c.docket_number ~ '^[0-9]+$' THEN 'N' ELSE 'other' END AS shape,
  count(*), min(c.filed_on) AS min_filed, max(c.filed_on) AS max_filed, min(c.decided_on) AS min_dec, max(c.decided_on) AS max_dec
FROM legal_case c JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
LEFT JOIN scotus_case_enrichment e ON e.case_id = c.id
WHERE c.publication = 'published'
GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5;

\echo '=== D2. five tier-1 SCOTUS cases with no decision date'
SELECT c.public_id, c.docket_number, left(c.caption, 80), c.filed_on, c.terminated_on, e.official_docket_url, e.docketed_on, e.lower_court_name, left(e.exact_disposition, 80)
FROM legal_case c JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
JOIN publication_tier_release t ON t.case_id = c.id AND t.state = 'published' AND t.tier = 1
LEFT JOIN scotus_case_enrichment e ON e.case_id = c.id
WHERE c.publication = 'published' AND c.decided_on IS NULL
ORDER BY md5(c.id::text) LIMIT 5;

\echo '=== D3. scotus_docket_document count and enrichment fields filled'
SELECT count(*) AS enrich_rows, count(exact_disposition) AS with_disposition, count(syllabus_text) AS with_syllabus,
  count(lower_court_name) AS with_lower, count(*) FILTER (WHERE verification = 'verified') AS verified
FROM scotus_case_enrichment;
SELECT count(*) AS scotus_docket_documents FROM scotus_docket_document;

\echo '=== E. overruled parentheticals: cited court vs citing court'
SELECT cited_court.provider_court_id AS cited, citing_court.provider_court_id AS citing, count(*)
FROM courtlistener_parenthetical p
JOIN legal_case cited ON cited.id = p.cited_case_id JOIN court cited_court ON cited_court.id = cited.court_id
JOIN document d ON d.id = p.citing_document_id JOIN legal_case citing ON citing.id = d.case_id JOIN court citing_court ON citing_court.id = citing.court_id
WHERE p.text ~* '^\s*((expressly|implicitly|partially)\s+)?(overruled|abrogated)\M'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40;

\echo '=== F. court table: appellate/district jurisdiction codes and a parent-circuit column if any'
SELECT column_name FROM information_schema.columns WHERE table_name = 'court' ORDER BY ordinal_position;
SELECT jurisdiction, count(*) FROM court GROUP BY 1 ORDER BY 2 DESC;
