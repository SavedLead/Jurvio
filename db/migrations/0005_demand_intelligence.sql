BEGIN;

CREATE TYPE visitor_class AS ENUM (
  'human', 'search_bot', 'ai_bot', 'agent', 'api', 'internal', 'unknown'
);
CREATE TYPE demand_event_type AS ENUM (
  'page_view', 'internal_search', 'document_view', 'explanation_request',
  'follow', 'share', 'source_click'
);
CREATE TYPE enrichment_request_status AS ENUM (
  'queued', 'blocked', 'processing', 'completed', 'failed', 'cancelled'
);

CREATE TABLE demand_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_date date GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'UTC')::date) STORED,
  event_type demand_event_type NOT NULL,
  visitor_class visitor_class NOT NULL DEFAULT 'unknown',
  case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  entity_id uuid REFERENCES entity(id) ON DELETE SET NULL,
  document_id uuid REFERENCES document(id) ON DELETE SET NULL,
  court_id uuid REFERENCES court(id) ON DELETE SET NULL,
  session_hash text,
  visitor_hash text,
  referrer_host text,
  bot_family text,
  search_query text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (session_hash IS NULL OR length(session_hash) >= 16),
  CHECK (visitor_hash IS NULL OR length(visitor_hash) >= 16)
);

CREATE INDEX demand_event_date_type_idx ON demand_event (event_date, event_type);
CREATE INDEX demand_event_case_date_idx ON demand_event (case_id, event_date)
  WHERE case_id IS NOT NULL;
CREATE INDEX demand_event_document_date_idx ON demand_event (document_id, event_date)
  WHERE document_id IS NOT NULL;
CREATE INDEX demand_event_visitor_class_idx ON demand_event (visitor_class, event_date);

CREATE TABLE enrichment_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (
    target_type IN ('case', 'document', 'docket_entry')
  ),
  target_id uuid NOT NULL,
  request_kind text NOT NULL CHECK (
    request_kind IN ('explain_case', 'summarize_filing', 'explain_order', 'next_steps')
  ),
  status enrichment_request_status NOT NULL DEFAULT 'queued',
  source_content_hash text,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  priority_score numeric(12,4) NOT NULL DEFAULT 0,
  estimated_cost_microusd bigint,
  actual_cost_microusd bigint,
  first_requested_at timestamptz NOT NULL DEFAULT now(),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  blocked_reason text,
  result_version text,
  result_id uuid,
  UNIQUE NULLS NOT DISTINCT (
    target_type, target_id, request_kind, source_content_hash
  )
);

CREATE INDEX enrichment_request_queue_idx
  ON enrichment_request (priority_score DESC, first_requested_at)
  WHERE status = 'queued';

COMMIT;
