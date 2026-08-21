import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { ingestCourtListenerDocket } from "@/modules/ingestion/application/ingest-courtlistener-docket";
import {
  finishIngestionRun,
  finishIngestionRunItem,
  startIngestionRun,
  startIngestionRunItem,
} from "@/modules/ingestion/application/ingestion-run";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";

function option(name: string): string | undefined {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const year = Number(option("year"));
const jurisdiction = option("jurisdiction")?.trim().toUpperCase();
const limit = Number(option("limit") ?? "100");
const delayMs = Number(option("delay-ms") ?? "1000");

if (!Number.isInteger(year) || year < 1900 || year > 2100) {
  throw new Error("--year must be 1900-2100");
}
if (!jurisdiction || !["F", "FD", "FB"].includes(jurisdiction)) {
  throw new Error("--jurisdiction must be F, FD, or FB");
}
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
  throw new Error("--limit must be 1-10000");
}
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms must be 0-60000");
}

env();
const sql = db();
const artifactStore = createArtifactStore({
  localRoot: process.env.RAW_ARTIFACT_DIR ?? process.env.JURVIO_ARTIFACT_ROOT ?? ".data/raw",
});

try {
  const rows = await sql<{ case_id: string; public_id: string; docket_id: string }[]>`
    SELECT legal_case.id AS case_id, legal_case.public_id,
      identifier.identifier_value AS docket_id
    FROM legal_case
    JOIN court ON court.id = legal_case.court_id
    JOIN case_identifier identifier ON identifier.case_id = legal_case.id
    WHERE legal_case.publication = 'draft'
      AND extract(year FROM legal_case.filed_on) = ${year}
      AND upper(coalesce(court.jurisdiction, '')) = ${jurisdiction}
      AND identifier.provider_id = (SELECT id FROM provider WHERE code = 'courtlistener')
      AND identifier.identifier_type = 'courtlistener_docket_id'
      AND identifier.identifier_value ~ '^[0-9]+$'
    ORDER BY legal_case.created_at, legal_case.id
    LIMIT ${limit}
  `;

  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "bulk-cohort-enrichment",
    selection: {
      year,
      jurisdiction,
      requestedLimit: limit,
      publication: "draft",
      policy: "unified-bulk-enrichment-v1",
    },
    selectedCount: rows.length,
  });

  let enriched = 0;
  let failed = 0;
  let parties = 0;
  let partyRejections = 0;
  let docketEntries = 0;
  let documents = 0;
  const errors: Array<{ caseId: string; docketId: string; error: string }> = [];

  try {
    for (const row of rows) {
      await startIngestionRunItem(sql, runId, row.docket_id);
      try {
        const result = await ingestCourtListenerDocket(
          sql,
          artifactStore,
          Number(row.docket_id),
        );
        enriched += 1;
        parties += result.parties.accepted;
        partyRejections += result.parties.rejected;
        docketEntries += result.docketEntries.accepted;
        documents += result.docketEntries.documents;
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: row.docket_id,
          casePublicId: result.caseId,
          documentCount: result.docketEntries.documents,
        });
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (errors.length < 100) {
          errors.push({ caseId: row.public_id, docketId: row.docket_id, error: message });
        }
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: row.docket_id,
          error: message,
        });
      }
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await finishIngestionRun(sql, runId);
  } catch (error) {
    await finishIngestionRun(
      sql,
      runId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  const failureRate = rows.length === 0 ? 0 : failed / rows.length;
  const result = {
    year,
    jurisdiction,
    selected: rows.length,
    enriched,
    failed,
    failureRate,
    parties,
    partyRejections,
    docketEntries,
    documents,
    costs: 0,
    errors,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (failureRate > 0.01) process.exitCode = 1;
} finally {
  await closeDb();
}
