-- Rule-versioned holds for the deterministic federal publisher.
--
-- The deterministic publisher (run-federal-ingestion-loop, publication-quarantine) used to
-- mark a held case `verification='needs_review'` and then skip every needs_review case on
-- later runs. That permanently suppressed cases held by an OLD gate rule even after the rule
-- improved -- e.g. cases held only because their court was unverified stayed held after the
-- court registry fix. This table records WHY a case was held and under WHICH rule version,
-- so the candidate query can skip a case only while its hold matches the CURRENT rule and
-- re-evaluate it once when the rule changes. It is the deterministic-path analogue of
-- citation_publication_hold.rule_version (migration 0119) for the cited path.

CREATE TABLE IF NOT EXISTS federal_publication_hold (
  case_id uuid PRIMARY KEY REFERENCES legal_case(id) ON DELETE CASCADE,
  reasons text[] NOT NULL DEFAULT '{}',
  rule_version text NOT NULL,
  held_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS federal_publication_hold_rule_version_idx
  ON federal_publication_hold (rule_version);
