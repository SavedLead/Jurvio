-- Read-only: Supreme Court docket lines the official parser typed wrongly before the
-- abbreviation / ordered-ruling / partial-grant fix (entry_type stays until a re-ingest),
-- plus routine filing requests on merits dockets still marked high importance.
WITH scotus AS (
  SELECT e.id, e.case_id, c.docket_number, e.entry_type, e.importance, e.description,
    regexp_replace(e.description, '\m(et\s+al|Inc|Corp|Co|Ltd|Jr|Sr|Dr|Mr|Mrs|Ms|St|No|Nos)\.', '\1', 'gi') AS t
  FROM docket_entry e
  JOIN legal_case c ON c.id = e.case_id
  JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
), flagged AS (
  SELECT *, CASE
    WHEN t ~* 'it\s+is\s+(hereby\s+)?ordered\s+that\s+the\s+application\M[^.]*?\mis\s+(hereby\s+)?(granted|denied)\M'
      AND t !~* 'stayed\s+pending\s+further\s+order|administrative(ly)?\s+stay' AND entry_type NOT LIKE 'application_%' THEN 'ordered_ruling'
    WHEN t ~* '^(The\s+)?application\M[^.]*\mgranted\M[^.]*\m(otherwise|in\s+all\s+other\s+respects)\s+denied\M' AND entry_type <> 'application_granted_in_part' THEN 'partial_grant'
    WHEN t ~* '^(The\s+)?application\M[^.]*\mgranted\s+in\s+part\M' AND entry_type <> 'application_granted_in_part' THEN 'partial_grant'
    WHEN t ~* '^The\s+application\M[^.]*\mis\s+(granted|denied)\M' AND entry_type NOT LIKE 'application_%' THEN 'the_application_ruling'
    WHEN t ~* '^Response\s+to\s+application\M[^.]*\mfiled\M' AND t !~* 'requested\s+by' AND entry_type <> 'application_response_filed' THEN 'response_filed_abbrev'
    WHEN btrim(docket_number) !~* '^\d{2}A\d{1,5}$' AND importance = 'high'
      AND entry_type IN ('application_granted', 'application_granted_in_part', 'application_denied')
      AND t ~* '(to\s+extend\s+the\s+time|extension\s+of\s+(the\s+)?time|extend(ing)?\s+the\s+time|word\s+limit|page\s+limit|in\s+excess\s+of\s+the\M|leave\s+to\s+file|to\s+file\s+(an?\s+)?(consolidated\s+)?(reply|response|amicus|supplemental)?\s*brief|consolidated\s+(response\s+)?brief|divided\s+argument|enlargement\s+of\s+time)' THEN 'merits_procedural_high'
  END AS gap
  FROM scotus
)
SELECT gap, count(*) AS entries, count(DISTINCT case_id) AS cases
FROM flagged WHERE gap IS NOT NULL GROUP BY ROLLUP (gap) ORDER BY gap NULLS LAST;

WITH scotus AS (
  SELECT e.id, e.case_id, c.docket_number, e.entry_type, e.importance, e.description,
    regexp_replace(e.description, '\m(et\s+al|Inc|Corp|Co|Ltd|Jr|Sr|Dr|Mr|Mrs|Ms|St|No|Nos)\.', '\1', 'gi') AS t
  FROM docket_entry e
  JOIN legal_case c ON c.id = e.case_id
  JOIN court ON court.id = c.court_id AND lower(court.provider_court_id) = 'scotus'
), flagged AS (
  SELECT *, CASE
    WHEN t ~* 'it\s+is\s+(hereby\s+)?ordered\s+that\s+the\s+application\M[^.]*?\mis\s+(hereby\s+)?(granted|denied)\M'
      AND t !~* 'stayed\s+pending\s+further\s+order|administrative(ly)?\s+stay' AND entry_type NOT LIKE 'application_%' THEN 'ordered_ruling'
    WHEN t ~* '^(The\s+)?application\M[^.]*\mgranted\M[^.]*\m(otherwise|in\s+all\s+other\s+respects)\s+denied\M' AND entry_type <> 'application_granted_in_part' THEN 'partial_grant'
    WHEN t ~* '^(The\s+)?application\M[^.]*\mgranted\s+in\s+part\M' AND entry_type <> 'application_granted_in_part' THEN 'partial_grant'
    WHEN t ~* '^The\s+application\M[^.]*\mis\s+(granted|denied)\M' AND entry_type NOT LIKE 'application_%' THEN 'the_application_ruling'
    WHEN t ~* '^Response\s+to\s+application\M[^.]*\mfiled\M' AND t !~* 'requested\s+by' AND entry_type <> 'application_response_filed' THEN 'response_filed_abbrev'
    WHEN btrim(docket_number) !~* '^\d{2}A\d{1,5}$' AND importance = 'high'
      AND entry_type IN ('application_granted', 'application_granted_in_part', 'application_denied')
      AND t ~* '(to\s+extend\s+the\s+time|extension\s+of\s+(the\s+)?time|extend(ing)?\s+the\s+time|word\s+limit|page\s+limit|in\s+excess\s+of\s+the\M|leave\s+to\s+file|to\s+file\s+(an?\s+)?(consolidated\s+)?(reply|response|amicus|supplemental)?\s*brief|consolidated\s+(response\s+)?brief|divided\s+argument|enlargement\s+of\s+time)' THEN 'merits_procedural_high'
  END AS gap
  FROM scotus
)
SELECT docket_number, gap, entry_type, left(description, 140) AS line
FROM (SELECT f.*, row_number() OVER (PARTITION BY gap ORDER BY docket_number DESC) AS rn FROM flagged f WHERE gap IS NOT NULL) x
WHERE rn <= 6 ORDER BY gap, docket_number DESC;
