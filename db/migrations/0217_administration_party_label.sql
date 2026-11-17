-- An administration label is the presidential term of a filing date, and only
-- when a federal government party is on the case. Earlier rows stored the
-- term for every application. Clear it where the applicant is not the federal
-- government. The live docket reader sets it again when a federal party,
-- including a federal respondent, is actually on the caption.

UPDATE scotus_application
SET administration = NULL, updated_at = now()
WHERE administration IS NOT NULL
  AND applicant_kind IS DISTINCT FROM 'federal';
