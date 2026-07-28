BEGIN;

UPDATE legal_case
SET caption = btrim(regexp_replace(
      caption,
      '[[:space:]]+Revisions?[[:space:]]*:[[:space:]]*[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}[[:space:]]*$',
      '',
      'i'
    )),
    updated_at = now()
FROM court
WHERE court.id = legal_case.court_id
  AND lower(court.provider_court_id) = 'scotus'
  AND legal_case.caption ~* '[[:space:]]+Revisions?[[:space:]]*:';

UPDATE opinion_cluster AS cluster
SET case_name = btrim(regexp_replace(
      cluster.case_name,
      '[[:space:]]+Revisions?[[:space:]]*:[[:space:]]*[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}[[:space:]]*$',
      '',
      'i'
    )),
    updated_at = now()
FROM legal_case
JOIN court ON court.id = legal_case.court_id
WHERE cluster.case_id = legal_case.id
  AND lower(court.provider_court_id) = 'scotus'
  AND cluster.case_name ~* '[[:space:]]+Revisions?[[:space:]]*:';

UPDATE document
SET title = regexp_replace(
      title,
      '[[:space:]]+Revisions?[[:space:]]*:[[:space:]]*[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}([[:space:]]+opinion)?[[:space:]]*$',
      '\1',
      'i'
    ),
    updated_at = now()
FROM legal_case
JOIN court ON court.id = legal_case.court_id
WHERE document.case_id = legal_case.id
  AND lower(court.provider_court_id) = 'scotus'
  AND document.title ~* '[[:space:]]+Revisions?[[:space:]]*:';

COMMIT;
