/**
 * Packet export for a later lower-court description job. The write command
 * refuses to run. This process does not call a model and does not publish.
 *
 *   pnpm exec tsx scripts/write-lower-court-briefs.ts export-sql
 *   pnpm exec tsx scripts/write-lower-court-briefs.ts spent-sql
 */
const command = process.argv[2];

function laneClause(lane: string): string {
  if (lane === "circuit") return "(court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%')";
  if (lane === "district") return "(court.jurisdiction = 'fd' OR court.jurisdiction ILIKE '%district%')";
  if (lane === "both") {
    return "((court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%') OR (court.jurisdiction = 'fd' OR court.jurisdiction ILIKE '%district%'))";
  }
  console.error("lane must be circuit, district, or both");
  process.exit(1);
}

function exportSql(lane: string): string {
  const where = laneClause(lane);
  return `COPY (
  SELECT regexp_replace(json_build_object(
    'caseId', c.id,
    'publicId', c.public_id,
    'docketNumber', c.docket_number,
    'caption', c.caption,
    'court', court.short_name,
    'level', CASE
      WHEN court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%' THEN 'circuit'
      ELSE 'district'
    END,
    'events', (
      SELECT coalesce(json_agg(json_build_object(
        'filedOn', e.filed_on,
        'description', e.description
      ) ORDER BY e.filed_on DESC NULLS LAST), '[]'::json)
      FROM (
        SELECT filed_on, description
        FROM docket_entry
        WHERE case_id = c.id
        ORDER BY filed_on DESC NULLS LAST
        LIMIT 40
      ) e
    )
  )::text, E'[\\n\\r]+', ' ', 'g')
  FROM legal_case c
  JOIN court ON court.id = c.court_id
  LEFT JOIN case_description d ON d.case_id = c.id
  WHERE c.publication = 'published'
    AND coalesce(court.provider_court_id, '') <> 'scotus'
    AND d.case_id IS NULL
    AND ${where}
  ORDER BY CASE
      WHEN court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%' THEN 0
      ELSE 1
    END,
    (SELECT max(e.filed_on) FROM docket_entry e WHERE e.case_id = c.id) DESC NULLS LAST,
    c.public_id
  LIMIT 400
) TO STDOUT;
`;
}

if (command === "export-sql") {
  process.stdout.write(exportSql(process.env.LANE ?? "both"));
  process.exit(0);
}
if (command === "spent-sql") {
  process.stdout.write("SELECT coalesce(sum(cost_usd), 0)::text FROM case_description_call;\n");
  process.exit(0);
}
console.error("Refusing to publish descriptions. Nothing was stored and no model was called.");
process.exit(1);
