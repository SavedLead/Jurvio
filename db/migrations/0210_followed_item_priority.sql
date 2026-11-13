-- Cases someone follows, or that match a judge, court, party, topic, or
-- emergency follow. The ingestion host refreshes this list ahead of backlog
-- work. A missing row is not an alert; docket alerts still key off a new
-- docket_entry.created_at after the follow.

CREATE TABLE IF NOT EXISTS followed_item_priority (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  reasons text[] NOT NULL,
  due_at timestamptz NOT NULL DEFAULT now(),
  last_refresh_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS followed_item_priority_due_idx
  ON followed_item_priority (due_at);

ALTER TABLE entity_follow DROP CONSTRAINT IF EXISTS entity_follow_kind_check;
ALTER TABLE entity_follow ADD CONSTRAINT entity_follow_kind_check
  CHECK (kind IN ('judge', 'topic', 'party', 'emergency', 'court'));
