-- An opinion's own closing words win over the reporter's disposition field when both exist.
INSERT INTO appeals_case_outcome (case_id, outcome, source, quote, rule_version, updated_at)
SELECT DISTINCT ON (i.case_id) i.case_id, i.outcome, i.source, i.quote, i.rule_version, now()
FROM incoming_outcome i JOIN legal_case c ON c.id = i.case_id
ORDER BY i.case_id, (i.source = 'opinion_closing') DESC
ON CONFLICT (case_id) DO UPDATE SET outcome = EXCLUDED.outcome, source = EXCLUDED.source, quote = EXCLUDED.quote,
  rule_version = EXCLUDED.rule_version, updated_at = now()
  WHERE appeals_case_outcome.source <> 'opinion_closing' OR EXCLUDED.source = 'opinion_closing';
COMMIT;
