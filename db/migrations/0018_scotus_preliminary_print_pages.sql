BEGIN;

ALTER TABLE official_opinion_candidate
  ADD COLUMN source_page_start integer CHECK (source_page_start IS NULL OR source_page_start >= 1),
  ADD COLUMN source_page_end integer CHECK (
    source_page_end IS NULL
    OR (source_page_start IS NOT NULL AND source_page_end >= source_page_start)
  );

COMMENT ON COLUMN official_opinion_candidate.source_page_start IS
  'One-based PDF page where the case begins when the official source is a preliminary-print volume.';
COMMENT ON COLUMN official_opinion_candidate.source_page_end IS
  'One-based inclusive PDF page where the case ends; NULL means the end of the official PDF.';

COMMIT;
