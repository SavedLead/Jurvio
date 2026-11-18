-- Extra public fields for an emergency application: topics, what is at
-- stake, the order, the two sides' points, and related dockets. The summary
-- itself stays on scotus_application_brief. Nothing here records how the
-- text was produced.

CREATE TABLE IF NOT EXISTS scotus_application_detail (
  docket_number text PRIMARY KEY REFERENCES scotus_application(docket_number) ON DELETE CASCADE,
  topics text[] NOT NULL DEFAULT '{}',
  stake text CHECK (stake IS NULL OR length(stake) BETWEEN 20 AND 280),
  order_explainer text CHECK (order_explainer IS NULL OR length(order_explainer) BETWEEN 20 AND 1200),
  applicant_points text[] NOT NULL DEFAULT '{}',
  respondent_points text[] NOT NULL DEFAULT '{}',
  related_dockets text[] NOT NULL DEFAULT '{}',
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scotus_application_detail_topics_idx
  ON scotus_application_detail USING gin (topics);
