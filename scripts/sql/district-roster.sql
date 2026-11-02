-- FJC service terms (Article III and magistrate) on federal district courts (read-only export for the district backfill).
COPY (
  SELECT t.judge_id, lower(c.provider_court_id), j.normalized_name, t.started_on, t.ended_on, t.appointing_president_party
  FROM judge_service_term t
  JOIN judge j ON j.id = t.judge_id
  JOIN court c ON c.id = t.court_id
  WHERE t.source_system IN ('fjc', 'brmag') AND c.jurisdiction IN ('FD', 'Federal District')
    AND c.provider_court_id IS NOT NULL
) TO STDOUT;
