import type postgres from "postgres";
import { extractOfficialOpinionMetadata } from "../providers/scotus/official-opinion-metadata";

type Sql = ReturnType<typeof postgres>;
interface Row { case_id: string; case_public_id: string; docket_number: string; document_id: string; source_url: string; content_text: string; }

export async function enrichOfficialScotusOpinionMetadata(sql: Sql, options: { limit: number }) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error("Enrichment limit must be between 1 and 100");
  const rows = await sql<Row[]>`
    SELECT legal_case.id AS case_id, legal_case.public_id AS case_public_id, legal_case.docket_number,
      document.id AS document_id, judicial.source_download_url AS source_url, content.content_text
    FROM legal_case JOIN court ON court.id = legal_case.court_id
    JOIN document ON document.case_id = legal_case.id
    JOIN judicial_opinion judicial ON judicial.document_id = document.id
    JOIN document_content content ON content.document_id = document.id
    LEFT JOIN scotus_case_enrichment enrichment ON enrichment.case_id = legal_case.id
    WHERE lower(court.provider_court_id) = 'scotus' AND legal_case.publication = 'published'
      AND judicial.source_download_url LIKE 'https://www.supremecourt.gov/%'
      AND (enrichment.parser_version IS DISTINCT FROM 'official-scotus-opinion-v2'
        OR (enrichment.completeness->>'opinionMetadataV2') IS DISTINCT FROM 'true')
    ORDER BY legal_case.decided_on DESC NULLS LAST, legal_case.id
    LIMIT ${options.limit}
  `;
  let enriched = 0;
  let partial = 0;
  let skipped = 0;
  const publicRecords: Array<{ caseId: string; holding: boolean; background: boolean; perCuriam: boolean }> = [];
  for (const row of rows) {
    // The official_docket_url CHECK constraint (migrations 0019/0020) only accepts a
    // docket number matching [0-9A-Za-z-]+. Historical bound-volume cases can carry a
    // docket number with other characters (or none); building the docket URL for one
    // throws a constraint violation that would crash the entire enrich lane. Skip it.
    if (!/^[0-9A-Za-z-]+$/.test(row.docket_number ?? "")) { skipped += 1; continue; }
    const metadata = extractOfficialOpinionMetadata(row.content_text);
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO scotus_case_enrichment (case_id, official_docket_url, background_summary,
          background_source_url, background_source_locator, significance_summary,
          significance_source_url, significance_source_locator, exact_holding, holding_source_url,
          holding_source_locator, exact_disposition, disposition_source_url, disposition_source_locator,
          syllabus_text, syllabus_source_url, syllabus_source_locator, decision_lineup, completeness,
          verification, parser_version, verified_at)
        VALUES (${row.case_id}, ${`https://www.supremecourt.gov/docket/docketfiles/html/public/${row.docket_number}.html`},
          ${metadata.background}, ${metadata.background ? row.source_url : null}, ${metadata.background ? 'Official syllabus: factual and procedural background' : null},
          ${metadata.significance}, ${metadata.significance ? row.source_url : null}, ${metadata.significance ? 'Official syllabus: first sentence of Held' : null},
          ${metadata.exactHolding}, ${metadata.exactHolding ? row.source_url : null}, ${metadata.exactHolding ? 'Official syllabus: Held' : null},
          ${metadata.exactDisposition}, ${metadata.exactDisposition ? row.source_url : null}, ${metadata.exactDisposition ? 'Opinion disposition paragraph' : null},
          ${metadata.syllabus}, ${metadata.syllabus ? row.source_url : null}, ${metadata.syllabus ? 'Official syllabus' : null},
          ${tx.json({ perCuriam: metadata.perCuriam, author: metadata.lineup.author, joins: metadata.lineup.joins,
            separateOpinions: metadata.lineup.separateOpinions, recusals: metadata.lineup.recusals,
            justiceVotes: metadata.lineup.justiceVotes, voteBreakdown: metadata.lineup.voteBreakdown })},
          ${tx.json({ opinionMetadata: true, opinionMetadataV2: true, lineupChecked: true,
            voteBreakdownAvailable: Boolean(metadata.lineup.voteBreakdown.label), holdingAvailable: Boolean(metadata.exactHolding),
            syllabusAvailable: Boolean(metadata.syllabus) })},
          'verified', 'official-scotus-opinion-v2', now())
        ON CONFLICT (case_id) DO UPDATE SET
          background_summary = COALESCE(EXCLUDED.background_summary, scotus_case_enrichment.background_summary),
          background_source_url = COALESCE(EXCLUDED.background_source_url, scotus_case_enrichment.background_source_url),
          background_source_locator = COALESCE(EXCLUDED.background_source_locator, scotus_case_enrichment.background_source_locator),
          significance_summary = COALESCE(EXCLUDED.significance_summary, scotus_case_enrichment.significance_summary),
          significance_source_url = COALESCE(EXCLUDED.significance_source_url, scotus_case_enrichment.significance_source_url),
          significance_source_locator = COALESCE(EXCLUDED.significance_source_locator, scotus_case_enrichment.significance_source_locator),
          exact_holding = COALESCE(EXCLUDED.exact_holding, scotus_case_enrichment.exact_holding),
          holding_source_url = COALESCE(EXCLUDED.holding_source_url, scotus_case_enrichment.holding_source_url),
          holding_source_locator = COALESCE(EXCLUDED.holding_source_locator, scotus_case_enrichment.holding_source_locator),
          exact_disposition = COALESCE(scotus_case_enrichment.exact_disposition, EXCLUDED.exact_disposition),
          disposition_source_url = COALESCE(scotus_case_enrichment.disposition_source_url, EXCLUDED.disposition_source_url),
          disposition_source_locator = COALESCE(scotus_case_enrichment.disposition_source_locator, EXCLUDED.disposition_source_locator),
          syllabus_text = COALESCE(EXCLUDED.syllabus_text, scotus_case_enrichment.syllabus_text),
          syllabus_source_url = COALESCE(EXCLUDED.syllabus_source_url, scotus_case_enrichment.syllabus_source_url),
          syllabus_source_locator = COALESCE(EXCLUDED.syllabus_source_locator, scotus_case_enrichment.syllabus_source_locator),
          decision_lineup = scotus_case_enrichment.decision_lineup || EXCLUDED.decision_lineup,
          completeness = scotus_case_enrichment.completeness || EXCLUDED.completeness,
          verification = 'verified', parser_version = EXCLUDED.parser_version, verified_at = now(), updated_at = now()
      `;
      if (metadata.perCuriam) await tx`
        UPDATE judicial_opinion SET per_curiam = true, author_name = NULL, updated_at = now()
        WHERE document_id = ${row.document_id}
      `;
      if (!metadata.perCuriam && metadata.lineup.author) await tx`
        UPDATE judicial_opinion SET author_name = ${metadata.lineup.author}, updated_at = now()
        WHERE document_id = ${row.document_id} AND author_name IS NULL
      `;
    });
    if (metadata.exactHolding || metadata.background) enriched += 1; else partial += 1;
    publicRecords.push({ caseId: row.case_public_id, holding: Boolean(metadata.exactHolding),
      background: Boolean(metadata.background), perCuriam: metadata.perCuriam });
  }
  return { selected: rows.length, enriched, partial, skipped, publicRecords };
}
