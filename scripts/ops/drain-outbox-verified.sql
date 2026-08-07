-- P3: verified drain of the write-only outbox_event backlog.
--
-- Marks published_at = now() ONLY for events whose underlying aggregate is
-- currently published AND displayable (the same publication gate the public
-- site enforces). Events whose aggregate is not published/displayable are left
-- HELD (published_at stays NULL) so a future real relay can still see them.
--
-- This is reversible (UPDATE ... SET published_at = NULL WHERE ...), and has NO
-- public-facing effect: outbox_event has no consumer; the affected cases are
-- already live. The drain only clears the internal "unrelayed" backlog metric.
--
-- Run in ONE batch call per invocation (LIMIT); the wrapper loops until 0.

WITH eligible AS (
  SELECT oe.id
  FROM outbox_event oe
  WHERE oe.published_at IS NULL
    AND (
      (oe.aggregate_type = 'legal_case' AND EXISTS (
        SELECT 1 FROM legal_case lc
        WHERE lc.id = oe.aggregate_id
          AND lc.publication = 'published'
          AND COALESCE((
            SELECT d.displayable FROM publication_decision d
            WHERE d.object_type = 'legal_case' AND d.object_id = lc.id
            ORDER BY d.decided_at DESC, d.id DESC LIMIT 1), false)))
      OR
      (oe.aggregate_type = 'document' AND EXISTS (
        SELECT 1 FROM document doc
        WHERE doc.id = oe.aggregate_id
          AND doc.publication = 'published'
          AND COALESCE((
            SELECT d.displayable FROM publication_decision d
            WHERE d.object_type = 'document' AND d.object_id = doc.id
            ORDER BY d.decided_at DESC, d.id DESC LIMIT 1), false)))
    )
  LIMIT :batch
)
UPDATE outbox_event o
SET published_at = now()
FROM eligible e
WHERE o.id = e.id
RETURNING o.id;
