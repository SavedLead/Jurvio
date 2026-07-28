BEGIN;

UPDATE scotus_case_enrichment enrichment
SET
  question_presented = 'Whether the Confrontation Clause permits the use of a screen at trial that blocks a child witness''s view of the defendant, without any individualized finding by the trial court that the screen is necessary to prevent trauma to the child.',
  question_source_url = 'https://www.supremecourt.gov/DocketPDF/24/24-1159/358459/20250509131914152_cert%20petition%20Pitts%20v%20Mississippi.pdf',
  question_source_locator = 'Petition for a Writ of Certiorari at i, Question Presented',
  completeness = enrichment.completeness || '{"questionPresented": true}'::jsonb,
  verification = 'verified',
  verified_at = now(),
  updated_at = now()
FROM legal_case, court
WHERE enrichment.case_id = legal_case.id
  AND court.id = legal_case.court_id
  AND lower(court.provider_court_id) = 'scotus'
  AND legal_case.docket_number = '24-1159';

COMMIT;
