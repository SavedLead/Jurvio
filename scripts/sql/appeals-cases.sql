-- One batch of published court of appeals cases after :'after' (keyset on id), with the
-- latest opinion cluster's printed judges line, the main opinion's named author, and the
-- reporter disposition. Read-only export for the appeals backfill.
COPY (
  SELECT lc.id, lc.court_id, lower(ct.provider_court_id), COALESCE(oc.date_filed, lc.decided_on),
    oc.judges, op.author_name, NULLIF(btrim(oc.provider_metadata->>'disposition'), '')
  FROM legal_case lc
  JOIN court ct ON ct.id = lc.court_id AND ct.provider_court_id ~* '^ca([0-9]+|dc|fed|fc)$'
  LEFT JOIN LATERAL (
    SELECT c.id, c.date_filed, c.judges, c.provider_metadata FROM opinion_cluster c
    WHERE c.case_id = lc.id ORDER BY (nullif(btrim(c.judges), '') IS NOT NULL) DESC, c.date_filed DESC NULLS LAST, c.id LIMIT 1
  ) oc ON true
  LEFT JOIN LATERAL (
    SELECT o.author_name FROM judicial_opinion o
    WHERE o.cluster_id = oc.id AND o.per_curiam = false AND btrim(coalesce(o.author_name, '')) <> ''
    ORDER BY (o.opinion_type ~* '(lead|majority|combined)') DESC, o.id LIMIT 1
  ) op ON true
  WHERE lc.publication = 'published' AND lc.id > :'after'::uuid
  ORDER BY lc.id
  LIMIT :batch
) TO STDOUT;
