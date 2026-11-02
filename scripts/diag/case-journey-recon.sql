-- Read-only recon for the case journey timeline (case-depth F5). Sampled where large.
\echo '== SCOTUS docket status: lower court names (top 25) and decided-on fill'
SELECT lower_court, count(*), count(lower_court_decided_on) AS with_decided FROM scotus_docket_status GROUP BY 1 ORDER BY 2 DESC LIMIT 25;
\echo '== SCOTUS enrichment: lower court case numbers fill'
SELECT count(*) AS rows, count(*) FILTER (WHERE jsonb_array_length(lower_court_case_numbers) > 0) AS with_numbers FROM scotus_case_enrichment;
\echo '== sample enrichment lower court numbers'
SELECT lower_court_name, lower_court_case_numbers::text, lower_court_decided_on FROM scotus_case_enrichment
WHERE jsonb_array_length(lower_court_case_numbers) > 0 ORDER BY lower_court_decided_on DESC NULLS LAST LIMIT 10;
\echo '== emergency applications (docket numbers with A) held'
SELECT count(*) FROM legal_case c JOIN court ct ON ct.id = c.court_id AND lower(ct.provider_court_id) = 'scotus' WHERE c.docket_number ~ '^[0-9]{2}A[0-9]+';
\echo '== appellate cases: filed_on fill and docket_number shape'
SELECT ct.provider_court_id, count(*), count(c.filed_on) AS with_filed, count(c.decided_on) AS with_decided,
  min(c.docket_number) AS min_docket, max(c.docket_number) AS max_docket
FROM legal_case c JOIN court ct ON ct.id = c.court_id
WHERE ct.provider_court_id ~ '^ca([0-9]+|dc|fed)$' AND c.publication = 'published' GROUP BY 1 ORDER BY 2 DESC;
\echo '== docket metadata keys on appellate cases (raw provider docket?)'
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  AND column_name ~ '(originating|appeal_from|lower|source_case|related_case|trial)' ORDER BY 1, 2;
\echo '== cluster metadata keys mentioning origin/appeal (5% sample)'
SELECT k, count(*) FROM (SELECT jsonb_object_keys(provider_metadata) k FROM opinion_cluster TABLESAMPLE SYSTEM (5) WHERE jsonb_typeof(provider_metadata) = 'object') x
WHERE k ~* '(origin|appeal|lower|docket|court|nature|disposition|posture|history)' GROUP BY 1 ORDER BY 2 DESC LIMIT 30;
\echo '== docket entries mentioning "Notice of appeal" / "USCA" (0.5% sample)'
SELECT count(*) FILTER (WHERE description ~* 'notice of appeal') AS notice_of_appeal,
  count(*) FILTER (WHERE description ~* 'usca|court of appeals') AS usca_mentions,
  count(*) FILTER (WHERE description ~* 'usca (case )?(no|number)[.:]? *[0-9]{2}-[0-9]+') AS usca_number
FROM docket_entry TABLESAMPLE SYSTEM (0.5);
