BEGIN;

CREATE TYPE internal_role AS ENUM ('viewer', 'reviewer', 'administrator');

CREATE TABLE internal_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  role internal_role NOT NULL DEFAULT 'viewer',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz
);

CREATE TABLE internal_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_internal_user_id uuid REFERENCES internal_user(id),
  action text NOT NULL,
  target_type text,
  target_id uuid,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX internal_audit_actor_date_idx
  ON internal_audit_event (actor_internal_user_id, occurred_at DESC);

ALTER TABLE publication_review
  ADD CONSTRAINT publication_review_reviewer_fk
  FOREIGN KEY (reviewer_id) REFERENCES internal_user(id);

ALTER TABLE agent_action
  ADD CONSTRAINT agent_action_approver_fk
  FOREIGN KEY (approved_by) REFERENCES internal_user(id);

COMMIT;
