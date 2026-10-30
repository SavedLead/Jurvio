-- District CM/ECF RSS retention (see direct-court-retention.ts). Every poll of a
-- district feed adds direct_court_event rows (and alert rows for linked events)
-- that are never removed, so the live feeds grew the database without bound.
-- The retention pass deletes old rows by age; these indexes keep that pass an
-- index range scan instead of a full scan every 10 minutes. docket_entry is not
-- touched: published entries stay on their cases forever.
--
-- Built CONCURRENTLY, each in its own committed chunk (no write lock on the
-- tables the live feed writes to).

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS direct_court_event_last_seen_idx
  ON direct_court_event (last_seen_at);

-- @commit

CREATE INDEX CONCURRENTLY IF NOT EXISTS direct_court_alert_event_created_idx
  ON direct_court_alert_event (created_at);
