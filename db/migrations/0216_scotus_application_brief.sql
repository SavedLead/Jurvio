-- AI descriptions of Supreme Court emergency applications.
-- Approved by David Rosenberg, 2026-11-17.
--
-- One row per application. The body is labeled AI-generated and is rewritten
-- when the public docket changes or the prompt version changes. ai_generated
-- cannot be turned off. Cost columns are the spend log for the $100 backfill
-- cap enforced by scripts/write-emergency-briefs.ts.

CREATE TABLE IF NOT EXISTS scotus_application_brief (
  docket_number text PRIMARY KEY REFERENCES scotus_application(docket_number) ON DELETE CASCADE,
  brief_kind text NOT NULL CHECK (brief_kind IN ('full', 'extension_line')),
  body text NOT NULL CHECK (length(body) BETWEEN 20 AND 6000),
  model text NOT NULL CHECK (length(model) BETWEEN 2 AND 80),
  prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 2 AND 40),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) NOT NULL CHECK (cost_usd >= 0),
  ai_generated boolean NOT NULL DEFAULT true CHECK (ai_generated),
  -- Copied from the application so a later run can see that a new filing,
  -- a ruling, or a newly withheld line arrived. A poll that changes nothing
  -- does not match these, so the description is not regenerated.
  entry_count integer NOT NULL CHECK (entry_count >= 0),
  last_entry_on date,
  status text NOT NULL,
  withheld_lines integer NOT NULL CHECK (withheld_lines >= 0),
  generated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per model call, including a description that was rejected. The $100
-- cap is the sum of this table, so a rejected call still counts and is not
-- retried until the public docket changes.
CREATE TABLE IF NOT EXISTS scotus_brief_call (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  docket_number text NOT NULL REFERENCES scotus_application(docket_number) ON DELETE CASCADE,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  model text NOT NULL CHECK (length(model) BETWEEN 2 AND 80),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) NOT NULL CHECK (cost_usd >= 0),
  stored boolean NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scotus_brief_call_docket_idx ON scotus_brief_call (docket_number, called_at DESC);
