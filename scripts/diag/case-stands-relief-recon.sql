-- Read-only recon for case-stands phase 6 (what each side asked for / won or lost).
-- Samples only published, displayable cases; entries mentioning sealing are excluded.
\pset format unaligned
\pset fieldsep ' | '
\pset footer off

\echo '=== A. district docket entries that file or rule on a motion (published FD cases, sample)'
WITH fd AS (
  SELECT c.id FROM legal_case c JOIN court ct ON ct.id = c.court_id
  WHERE c.publication = 'published' AND upper(coalesce(ct.jurisdiction, '')) IN ('FD', 'FEDERAL DISTRICT')
), e AS (
  SELECT e.case_id, e.entry_number, e.filed_on, regexp_replace(left(e.description, 260), '\s+', ' ', 'g') AS d
  FROM docket_entry e JOIN fd ON fd.id = e.case_id
  WHERE e.description !~* 'seal|restricted'
)
SELECT 'motion' AS k, count(*) FILTER (WHERE d ~* '^(\S+\s+){0,3}motion\s+(for|to)\b') AS n_motion,
  count(*) FILTER (WHERE d ~* '^(memorandum|order|opinion|judgment)' AND d ~* '(granting|denying)') AS n_order_verb,
  count(*) FILTER (WHERE d ~* 'motion.{0,120}\m(is|are)\s+(hereby\s+)?(granted|denied)') AS n_order_passive,
  count(DISTINCT case_id) AS cases
FROM e;

WITH fd AS (
  SELECT c.id FROM legal_case c JOIN court ct ON ct.id = c.court_id
  WHERE c.publication = 'published' AND upper(coalesce(ct.jurisdiction, '')) IN ('FD', 'FEDERAL DISTRICT')
)
SELECT * FROM (
  SELECT 'M' AS k, e.entry_number, regexp_replace(left(e.description, 240), '\s+', ' ', 'g') AS d
  FROM docket_entry e JOIN fd ON fd.id = e.case_id
  WHERE e.description !~* 'seal|restricted' AND e.description ~* '^(\S+\s+){0,3}motion\s+(for|to)\b'
  ORDER BY md5(e.id::text) LIMIT 60) a
UNION ALL SELECT * FROM (
  SELECT 'O', e.entry_number, regexp_replace(left(e.description, 260), '\s+', ' ', 'g')
  FROM docket_entry e JOIN fd ON fd.id = e.case_id
  WHERE e.description !~* 'seal|restricted' AND e.description ~* '^(memorandum|order|opinion|judgment)'
    AND e.description ~* '(granting|denying|\m(is|are)\s+(hereby\s+)?(granted|denied))'
  ORDER BY md5(e.id::text) LIMIT 80) b;

\echo '=== B. appellate opinion openings: request sentences (sample of 250 published opinions)'
WITH docs AS (
  SELECT d.id, left(dc.content_text, 9000) AS head
  FROM document d JOIN document_content dc ON dc.document_id = d.id
  JOIN legal_case c ON c.id = d.case_id AND c.publication = 'published'
  JOIN court ct ON ct.id = c.court_id AND upper(coalesce(ct.jurisdiction, '')) = 'F'
  WHERE d.publication = 'published' AND d.document_type ILIKE '%opinion%'
  ORDER BY md5(d.id::text) LIMIT 250
)
SELECT left(regexp_replace(m[1], '\s+', ' ', 'g'), 260) AS sentence
FROM docs, regexp_matches(docs.head, '([^.]{0,160}\m(asks?|urges?|requests?|seeks?|seeking|appeals?)\s+(us\s+|this\s+court\s+|the\s+court\s+)?(to\s+|that\s+|from\s+|his\s+|her\s+|their\s+|its\s+|the\s+|reversal|vacatur|a\s+new)[^.]{0,200}\.)', 'g') AS m
LIMIT 120;

\echo '=== C. appellate closings naming specific relief (same sample)'
WITH docs AS (
  SELECT d.id, right(dc.content_text, 1600) AS tail
  FROM document d JOIN document_content dc ON dc.document_id = d.id
  JOIN legal_case c ON c.id = d.case_id AND c.publication = 'published'
  JOIN court ct ON ct.id = c.court_id AND upper(coalesce(ct.jurisdiction, '')) = 'F'
  WHERE d.publication = 'published' AND d.document_type ILIKE '%opinion%'
  ORDER BY md5(d.id::text) LIMIT 250
)
SELECT left(regexp_replace(m[1], '\s+', ' ', 'g'), 300)
FROM docs, regexp_matches(docs.tail, '([^.]{0,200}\m(convictions?|sentences?|new\s+trial|resentencing|acquittal|instructions\s+to\s+dismiss)[^.]{0,160}\.)', 'g') AS m
WHERE m[1] ~* '(affirm|revers|vacat|remand)'
LIMIT 80;

\echo '=== D. Supreme Court docket status rows (if 0185 loaded)'
SELECT cert_status, count(*), count(judgment_entry) FROM scotus_docket_status GROUP BY 1 ORDER BY 1;
