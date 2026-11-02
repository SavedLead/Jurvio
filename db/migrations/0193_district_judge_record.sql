-- District court opinions and the judges who wrote them, for lower-court judge analytics.
--
-- district_opinion_judge: one row per judge name printed on a published district court
-- opinion (the reporter's "judges" line, usually the deciding judge's surname, and the
-- opinion's named author), matched by the same fixed rules as appeals_panel_seat (0192):
-- linked only when exactly one Federal Judicial Center judge (or magistrate judge from the
-- FJC magistrate roster) with that surname served on that district court on the decision
-- date. Ambiguous and unmatched names are kept (judge_id NULL) so match rates are honest.
-- appointing_party is copied from the FJC record and describes the appointing president only
-- (NULL for magistrate judges, who are appointed by the district court).
--
-- Written by scripts/backfill-appeals-judge-record.ts (district mode) on the builder.

CREATE TABLE IF NOT EXISTS district_opinion_judge (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES court(id),
  decided_on date,
  seat_index smallint NOT NULL CHECK (seat_index >= 0 AND seat_index < 40),
  role text NOT NULL CHECK (role IN ('judge_line', 'author')),
  observed_name text NOT NULL,
  judge_id uuid REFERENCES judge(id) ON DELETE SET NULL,
  match_status text NOT NULL CHECK (match_status IN ('matched', 'ambiguous', 'unmatched')),
  appointing_party text,
  matcher_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, role, seat_index),
  CHECK ((match_status = 'matched') = (judge_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS district_opinion_judge_judge_idx ON district_opinion_judge (judge_id, role) WHERE judge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS district_opinion_judge_court_idx ON district_opinion_judge (court_id, role, match_status);
