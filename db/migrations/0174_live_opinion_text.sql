-- Live-feed opinion text (ADR 0090, plan D11).
--
-- The live feeds (district court-site opinion lists, circuit site feeds, GovInfo
-- USCOURTS district packages) record THAT an opinion was issued, as a docket
-- entry or free_source_item, but not its text, so new opinions never reach the
-- citation parser. live_opinion_text is the queue that fetches each opinion PDF
-- politely, extracts text (pdftotext, tesseract OCR fallback) and stores it as a
-- DRAFT document + document_content on the case, which fires the existing
-- citation triggers. Nothing here publishes; sealed/restricted captions are
-- never queued. Circuit GovInfo packages are already handled by the official
-- appellate pipeline (appellate_ingestion_item) and are not queued here.
SET lock_timeout = '60s';

CREATE TABLE IF NOT EXISTS live_opinion_text (
  id bigserial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('court_site', 'coa_feed', 'govinfo')),
  source_key text NOT NULL,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  docket_entry_id uuid REFERENCES docket_entry(id) ON DELETE SET NULL,
  court_code text NOT NULL,
  document_url text NOT NULL,
  filed_on date,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'extracted', 'ocr_required', 'duplicate', 'skipped', 'failed')),
  attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  document_id uuid REFERENCES document(id) ON DELETE SET NULL,
  extraction_method text,
  word_count integer,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  extracted_at timestamptz,
  UNIQUE (source, source_key)
);
CREATE INDEX IF NOT EXISTS live_opinion_text_due_idx
  ON live_opinion_text (next_attempt_at, filed_on DESC NULLS LAST) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS live_opinion_text_ocr_idx
  ON live_opinion_text (filed_on DESC NULLS LAST) WHERE state = 'ocr_required';
CREATE INDEX IF NOT EXISTS live_opinion_text_case_idx ON live_opinion_text (case_id);

-- Discovery watermark per source (single rows keyed by source).
CREATE TABLE IF NOT EXISTS live_opinion_text_watermark (
  source text PRIMARY KEY,
  discovered_through timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
