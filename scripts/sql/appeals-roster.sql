-- FJC service terms on federal courts of appeals (read-only export for the appeals backfill).
COPY (
  SELECT t.judge_id, lower(c.provider_court_id), j.normalized_name, t.started_on, t.ended_on, t.appointing_president_party
  FROM judge_service_term t
  JOIN judge j ON j.id = t.judge_id
  JOIN court c ON c.id = t.court_id
  WHERE t.source_system = 'fjc' AND c.provider_court_id ~* '^ca([0-9]+|dc|fed)$'
) TO STDOUT;
