-- Court of appeals panels and outcomes, for lower-court judge analytics.
--
-- appeals_panel_seat: one row per judge name printed on a court of appeals
-- opinion (the reporter's "judges" line and the opinion's named author),
-- matched by fixed rules to a Federal Judicial Center (FJC) judge who served
-- on that court on the decision date. Only an exact single surname match is
-- linked; ambiguous and unmatched names are kept (judge_id NULL) so match
-- rates can be shown honestly. The appointing president's party is copied
-- from the FJC service record at match time; it describes the appointing
-- president only.
--
-- appeals_case_outcome: the outcome of a court of appeals case read by fixed
-- word rules from the reporter's disposition field or the closing lines of
-- the court's own opinion, with the exact quote kept.
--
-- Written by scripts/backfill-appeals-judge-record.ts on the builder; read by
-- already-published judge pages.

CREATE TABLE IF NOT EXISTS appeals_panel_seat (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES court(id),
  decided_on date,
  seat_index smallint NOT NULL CHECK (seat_index >= 0 AND seat_index < 40),
  role text NOT NULL CHECK (role IN ('panel', 'author')),
  observed_name text NOT NULL,
  judge_id uuid REFERENCES judge(id) ON DELETE SET NULL,
  match_status text NOT NULL CHECK (match_status IN ('matched', 'ambiguous', 'unmatched')),
  appointing_party text,
  matcher_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, role, seat_index),
  CHECK ((match_status = 'matched') = (judge_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS appeals_panel_seat_judge_idx ON appeals_panel_seat (judge_id, role) WHERE judge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appeals_panel_seat_court_idx ON appeals_panel_seat (court_id, role, match_status);

CREATE TABLE IF NOT EXISTS appeals_case_outcome (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('affirmed', 'reversed', 'vacated', 'mixed', 'dismissed', 'remanded', 'review_granted', 'review_denied')),
  source text NOT NULL CHECK (source IN ('reporter_disposition', 'opinion_closing')),
  quote text NOT NULL,
  rule_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
