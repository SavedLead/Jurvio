-- Judge Control Center facets: capture the appointing president and a normalized
-- court category (scotus / appeals / district) per appointment so the roster can
-- be grouped, filtered, and sorted by branch, court, appointing president, and
-- appointment date. All three come straight from the authoritative FJC feed
-- (columns "Appointing President", "Party of Appointing President", "Court Type").
ALTER TABLE judge_service_term
  ADD COLUMN IF NOT EXISTS appointing_president text,
  ADD COLUMN IF NOT EXISTS appointing_president_party text,
  ADD COLUMN IF NOT EXISTS court_category text
    CHECK (court_category IN ('scotus', 'appeals', 'district', 'other'));

-- Fast faceting for the control-center table.
CREATE INDEX IF NOT EXISTS judge_service_term_category_idx
  ON judge_service_term (court_category);
CREATE INDEX IF NOT EXISTS judge_service_term_president_idx
  ON judge_service_term (appointing_president);
