BEGIN;

ALTER TABLE scotus_case_enrichment
  DROP CONSTRAINT scotus_case_enrichment_official_docket_url_check;

ALTER TABLE scotus_case_enrichment
  ADD CONSTRAINT scotus_case_enrichment_official_docket_url_check
  CHECK (
    official_docket_url ~
      '^https://www[.]supremecourt[.]gov/docket/docketfiles/html/public/[^/?#]+[.]html$'
  );

COMMIT;
