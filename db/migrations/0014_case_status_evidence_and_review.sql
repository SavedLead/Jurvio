BEGIN;

ALTER TABLE case_status_event
  ADD COLUMN source_label text,
  ADD COLUMN verified_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE legal_case
  ADD COLUMN status_fact text,
  ADD COLUMN status_procedural_possibilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN status_verified_at timestamptz;

CREATE TABLE case_status_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE RESTRICT,
  status_event_id uuid REFERENCES case_status_event(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN ('ambiguous_event', 'conflicting_events', 'unsupported_sequence', 'missing_source', 'stale_status', 'manual_flag')),
  detail text NOT NULL,
  rule_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'confirmed', 'rule_change_required', 'dismissed')),
  assigned_to uuid REFERENCES internal_user(id),
  reviewed_by uuid REFERENCES internal_user(id),
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK (status IN ('pending', 'in_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_notes IS NOT NULL))
);

CREATE UNIQUE INDEX case_status_review_active_event_idx ON case_status_review(case_id, status_event_id, reason_code)
  WHERE status IN ('pending', 'in_review');
CREATE INDEX case_status_review_queue_idx ON case_status_review(status, created_at);

COMMIT;
