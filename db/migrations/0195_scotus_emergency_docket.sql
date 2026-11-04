-- Supreme Court emergency docket (approved by the owner 2026-11-04).
--
-- scotus_application: one row per "A" docket (26A624), rebuilt from the
--   Court's public docket page each time the page changes. Only lines that
--   pass the strict sealed/restricted word filter are read; withheld_lines
--   counts the rest so the page can say some lines are not shown.
-- scotus_application_event: one row per public docket line, with when Jurvio
--   first saw it (detected_at) so Jurvio can measure its own speed.
-- scotus_source_poll: conditional-request state per polled URL
--   (Last-Modified / If-Modified-Since) and when to check it next.
-- entity_follow.kind gains 'emergency' (target_key = a feed slug from
--   src/modules/scotus/domain/emergency-application.ts, e.g. 'all', 'federal').

CREATE TABLE IF NOT EXISTS scotus_application (
  docket_number text PRIMARY KEY CHECK (docket_number ~ '^[0-9]{2}A[0-9]{1,4}$'),
  case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  caption text NOT NULL CHECK (length(caption) BETWEEN 1 AND 600),
  applicant text,
  kind text NOT NULL CHECK (kind IN ('extension', 'stay', 'stay_of_execution', 'injunction', 'vacate_stay', 'bail', 'other')),
  capital boolean NOT NULL DEFAULT false,
  applicant_kind text NOT NULL CHECK (applicant_kind IN ('federal', 'state', 'private')),
  administration text,
  lower_court text,
  lower_case_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_docket text,
  expected_justice text,
  submitted_justice text,
  submitted_justice_slug text,
  submitted_on date,
  docketed_on date,
  referred_on date,
  response_due_on date,
  response_due_text text,
  response_requested_by text,
  admin_stay_on date,
  admin_stay_justice text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'granted_in_part', 'denied', 'withdrawn', 'moot', 'converted')),
  ruling_on date,
  ruled_by text CHECK (ruled_by IN ('court', 'justice')),
  written_reasons boolean NOT NULL DEFAULT false,
  noted_votes jsonb NOT NULL DEFAULT '[]'::jsonb,
  amicus_count integer NOT NULL DEFAULT 0,
  entry_count integer NOT NULL DEFAULT 0,
  withheld_lines integer NOT NULL DEFAULT 0,
  last_entry_on date,
  poll_tier text NOT NULL DEFAULT 'open' CHECK (poll_tier IN ('hot', 'open', 'routine', 'closed', 'retired')),
  source_url text NOT NULL,
  parser_version text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scotus_application_list_idx ON scotus_application (kind, status, last_entry_on DESC);
CREATE INDEX IF NOT EXISTS scotus_application_case_idx ON scotus_application (case_id);

CREATE TABLE IF NOT EXISTS scotus_application_event (
  source_record_id text PRIMARY KEY CHECK (length(source_record_id) BETWEEN 5 AND 120),
  docket_number text NOT NULL REFERENCES scotus_application(docket_number) ON DELETE CASCADE,
  position integer NOT NULL,
  filed_on date,
  kind text NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 6000),
  plain_line text NOT NULL,
  justices text[] NOT NULL DEFAULT '{}',
  detected_at timestamptz NOT NULL DEFAULT now(),
  -- Set only when the docket page itself was new to Jurvio (first read), so
  -- latency numbers count only lines Jurvio saw appear.
  backfilled boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS scotus_application_event_docket_idx ON scotus_application_event (docket_number, position);
CREATE INDEX IF NOT EXISTS scotus_application_event_detected_idx ON scotus_application_event (detected_at DESC);

CREATE TABLE IF NOT EXISTS scotus_source_poll (
  url text PRIMARY KEY CHECK (url ~ '^https://www\.supremecourt\.gov/'),
  docket_number text,
  last_status integer,
  last_modified text,
  checked_at timestamptz,
  changed_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scotus_source_poll_due_idx ON scotus_source_poll (next_check_at);

ALTER TABLE entity_follow DROP CONSTRAINT IF EXISTS entity_follow_kind_check;
ALTER TABLE entity_follow ADD CONSTRAINT entity_follow_kind_check CHECK (kind IN ('judge', 'topic', 'party', 'emergency'));
