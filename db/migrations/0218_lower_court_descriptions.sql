-- Descriptions for published court of appeals and district cases.
-- Written only by the leftover-credit job, which is dispatched by hand after
-- a budget is approved. gpt-6.1-sol is the only model this table is for.
-- The job is not on a schedule. It does not send email.

CREATE TABLE IF NOT EXISTS case_description (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 20 AND 4000),
  model text NOT NULL CHECK (model = 'gpt-6.1-sol'),
  prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 2 AND 40),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) NOT NULL CHECK (cost_usd >= 0),
  entry_count integer NOT NULL CHECK (entry_count >= 0),
  last_entry_on date,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_description_call (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  model text NOT NULL CHECK (model = 'gpt-6.1-sol'),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) NOT NULL CHECK (cost_usd >= 0),
  stored boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
