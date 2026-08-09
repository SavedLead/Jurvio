-- Retention prune for the write-only outbox_event log. Deletes events that have
-- already been marked relayed (published_at set) and are older than the
-- retention window, in one bounded batch per call (the wrapper loops until 0).
-- Never deletes unpublished/held events, so nothing eligible-but-unrelayed is
-- lost. :days and :batch are supplied by the caller.
WITH old AS (
  SELECT id FROM outbox_event
  WHERE published_at IS NOT NULL
    AND published_at < now() - make_interval(days => :days)
  ORDER BY published_at
  LIMIT :batch
)
DELETE FROM outbox_event o USING old WHERE o.id = old.id
RETURNING o.id;
