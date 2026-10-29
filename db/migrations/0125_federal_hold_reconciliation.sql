-- Reconcile federal publication holds and point the chunk ledger at the durable
-- artifacts-volume path.
--
-- 1. Chunk files were recorded as /var/lib/jurvio/federal-chunks/... which lives on
--    the worker container's writable layer and disappears when that container is
--    recreated. release-production.sh copies them to the artifacts volume before
--    recreate; this updates the ledger to match. The importer also resolves either
--    path at runtime.
-- 2. SCOTUS is not a federal-publisher court (the official pipeline owns it, and the
--    registry leaves it unverified on purpose). Drop those holds and return still-draft
--    rows this lane marked needs_review back to not_verified.
-- 3. A hold whose only reason is missing_readable_content is stale once opinion text
--    exists. Delete those rows so the resident publisher re-evaluates the case under
--    the current rule. This does not publish anything by itself, and it does not
--    waive any other hold reason.

UPDATE federal_import_chunk
SET file_path = replace(
      file_path,
      '/var/lib/jurvio/federal-chunks/',
      '/var/lib/jurvio/artifacts/federal-chunks/'
    ),
    updated_at = now()
WHERE file_path LIKE '/var/lib/jurvio/federal-chunks/%';

UPDATE legal_case AS lc
SET verification = 'not_verified',
    updated_at = now()
FROM court AS c
WHERE lc.court_id = c.id
  AND lower(c.provider_court_id) = 'scotus'
  AND lc.publication = 'draft'
  AND lc.verification = 'needs_review'
  AND EXISTS (
    SELECT 1 FROM federal_publication_hold h
    WHERE h.case_id = lc.id
  );

DELETE FROM federal_publication_hold h
USING legal_case lc, court c
WHERE h.case_id = lc.id
  AND lc.court_id = c.id
  AND lower(c.provider_court_id) = 'scotus';

DELETE FROM federal_publication_hold h
WHERE h.reasons = ARRAY['missing_readable_content']::text[]
  AND EXISTS (
    SELECT 1
    FROM document d
    JOIN document_content content ON content.document_id = d.id
    WHERE d.case_id = h.case_id
      AND length(btrim(content.content_text)) > 0
  );
