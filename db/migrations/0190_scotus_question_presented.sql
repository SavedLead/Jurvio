-- Case stands phase 6: what the petitioner asked the Supreme Court to decide.
--
-- scotus_question_presented: the questions presented for a Supreme Court case
--   we hold, read from the Court's own "questions presented" PDF
--   (https://www.supremecourt.gov/qp/YY-NNNNNqp.pdf, linked from the docket page
--   once review is granted). Each question is kept verbatim; nothing is
--   summarized. Filled by the dispatch-only backfill-case-outcome-sources-once
--   workflow on the builder; read only by already-published case pages.

CREATE TABLE IF NOT EXISTS scotus_question_presented (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  docket_number text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://www[.]supremecourt[.]gov/qp/'),
  fetched_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  parser_version text NOT NULL,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) BETWEEN 1 AND 8),
  granted_limited_to smallint[],
  granted_question text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
