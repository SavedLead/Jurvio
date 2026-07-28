import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { ingestCourtListenerDocket } from "@/modules/ingestion/application/ingest-courtlistener-docket";
import { ingestCourtListenerOpinionCluster } from "@/modules/ingestion/application/ingest-courtlistener-opinion-cluster";
import {
  finishIngestionRun,
  finishIngestionRunItem,
  startIngestionRun,
  startIngestionRunItem,
} from "@/modules/ingestion/application/ingestion-run";
import {
  decodeStreamCursor,
  encodeStreamCursor,
  isNonBankruptcyFederalJurisdiction,
  isRestrictedDocketText,
  nextBatchSize,
  normalizeBatchSize,
  type FederalLoop,
  type StreamCursor,
} from "@/modules/ingestion/domain/federal-stream";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import {
  fetchDocketPage,
  fetchOpinionClusterIds,
} from "@/modules/ingestion/providers/courtlistener/client";

function option(name: string, fallback: string): string {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const loop = option("loop", "new-case-discovery") as FederalLoop;
const requestedLimit = normalizeBatchSize(Number(option("limit", "100")));
const delayMs = Number(option("delay-ms", "1000"));
const lookbackDays = Number(option("lookback-days", "2"));
const allowedLoops: FederalLoop[] = [
  "new-case-discovery",
  "active-case-updates",
  "material-decisions",
  "historical-backfill",
  "publication-quarantine",
];
if (!allowedLoops.includes(loop)) throw new Error("--loop is invalid");
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms must be 0-60000");
}
if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
  throw new Error("--lookback-days must be 1-365");
}

const sql = db();
const artifactStore = new LocalArtifactStore(
  process.env.RAW_ARTIFACT_DIR ?? process.env.JURVIO_ARTIFACT_ROOT ?? ".data/raw",
);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function providerId(): Promise<string> {
  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'courtlistener'
  `;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  return provider.id;
}

async function readCheckpoint(streamName: string, fallback: StreamCursor): Promise<StreamCursor> {
  const id = await providerId();
  const [row] = await sql<{ cursor_value: string }[]>`
    SELECT cursor_value FROM ingestion_checkpoint
    WHERE provider_id = ${id} AND stream_name = ${streamName}
  `;
  return decodeStreamCursor(row?.cursor_value ?? null, fallback);
}

async function writeCheckpoint(streamName: string, cursor: StreamCursor): Promise<void> {
  const id = await providerId();
  await sql`
    INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
    VALUES (${id}, ${streamName}, ${encodeStreamCursor(cursor)})
    ON CONFLICT (provider_id, stream_name)
    DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
  `;
}

async function courtIsFederal(courtUri: string): Promise<boolean> {
  const courtCode = courtUri.split("/").filter(Boolean).at(-1) ?? courtUri;
  const [court] = await sql<{ jurisdiction: string | null }[]>`
    SELECT jurisdiction FROM court
    WHERE provider_court_id = ${courtCode}
      AND provider_id = (SELECT id FROM provider WHERE code = 'courtlistener')
  `;
  return isNonBankruptcyFederalJurisdiction(court?.jurisdiction ?? null);
}

async function runDocketStream(kind: "new-case-discovery" | "historical-backfill") {
  const now = new Date().toISOString();
  const fallback: StreamCursor = kind === "new-case-discovery"
    ? {
        version: 1,
        windowStart: isoDaysAgo(lookbackDays),
        windowEnd: now,
        next: null,
        batchSize: 100,
        completedWindows: 0,
      }
    : {
        version: 1,
        windowStart: "2000-01-01T00:00:00.000Z",
        windowEnd: "2001-01-01T00:00:00.000Z",
        next: null,
        batchSize: 100,
        completedWindows: 0,
      };
  const streamName = `federal:${kind}:v1`;
  const checkpoint = await readCheckpoint(streamName, fallback);
  const limit = Math.min(requestedLimit, checkpoint.batchSize);
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: kind,
    selection: { ...checkpoint, requestedLimit, effectiveLimit: limit },
    selectedCount: limit,
  });

  let discovered = 0;
  let inserted = 0;
  let updated = 0;
  let held = 0;
  let failed = 0;
  let docketEntries = 0;
  let documents = 0;
  let next = checkpoint.next;
  let sourceTotal: number | null = null;

  try {
    while (discovered < limit) {
      const page = await fetchDocketPage({
        modifiedAfter: checkpoint.windowStart,
        modifiedBefore: checkpoint.windowEnd,
        cursor: next ?? undefined,
      });
      sourceTotal ??= page.total;
      if (page.records.length === 0) {
        next = null;
        break;
      }

      for (const retrieved of page.records) {
        if (discovered >= limit) break;
        discovered += 1;
        const sourceId = String(retrieved.record.id);
        await startIngestionRunItem(sql, runId, sourceId);
        try {
          if (!(await courtIsFederal(retrieved.record.court))) {
            held += 1;
            await finishIngestionRunItem(sql, {
              runId,
              sourceRecordId: sourceId,
              error: "Held: court is not a verified non-bankruptcy federal jurisdiction",
            });
            continue;
          }
          if (isRestrictedDocketText(
            `${retrieved.record.case_name} ${retrieved.record.docket_number}`,
          )) {
            held += 1;
            await finishIngestionRunItem(sql, {
              runId,
              sourceRecordId: sourceId,
              error: "Held: restricted or sensitive docket marker",
            });
            continue;
          }

          const [existing] = await sql<{ id: string }[]>`
            SELECT legal_case.id
            FROM case_identifier
            JOIN legal_case ON legal_case.id = case_identifier.case_id
            WHERE case_identifier.provider_id =
              (SELECT id FROM provider WHERE code = 'courtlistener')
              AND case_identifier.identifier_type = 'courtlistener_docket_id'
              AND case_identifier.identifier_value = ${sourceId}
          `;
          const result = await ingestCourtListenerDocket(
            sql,
            artifactStore,
            retrieved.record.id,
          );
          if (existing) updated += 1;
          else inserted += 1;
          docketEntries += result.docketEntries.accepted;
          documents += result.docketEntries.documents;
          await finishIngestionRunItem(sql, {
            runId,
            sourceRecordId: sourceId,
            casePublicId: result.caseId,
            documentCount: result.docketEntries.documents,
          });
        } catch (error) {
          failed += 1;
          await finishIngestionRunItem(sql, {
            runId,
            sourceRecordId: sourceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      next = page.next;
      await writeCheckpoint(streamName, { ...checkpoint, next });
      if (!next) break;
    }

    const completedWindow = next === null;
    const batchSize = nextBatchSize(limit, failed, held);
    const nextCursor: StreamCursor = completedWindow
      ? kind === "new-case-discovery"
        ? {
            version: 1,
            windowStart: checkpoint.windowEnd,
            windowEnd: new Date().toISOString(),
            next: null,
            batchSize,
            completedWindows: checkpoint.completedWindows + 1,
          }
        : {
            version: 1,
            windowStart: checkpoint.windowEnd,
            windowEnd: new Date(
              new Date(checkpoint.windowEnd).getTime() + 365 * 86_400_000,
            ).toISOString(),
            next: null,
            batchSize,
            completedWindows: checkpoint.completedWindows + 1,
          }
      : { ...checkpoint, next, batchSize };
    await writeCheckpoint(streamName, nextCursor);
    await finishIngestionRun(sql, runId);
    return {
      loop: kind,
      runId,
      discovered,
      inserted,
      updated,
      duplicated: 0,
      held,
      failed,
      docketEntries,
      documents,
      sourceTotal,
      checkpoint: nextCursor,
      remainingEstimate: sourceTotal == null ? null : Math.max(0, sourceTotal - discovered),
      costs: 0,
    };
  } catch (error) {
    await finishIngestionRun(
      sql,
      runId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

async function runActiveUpdates() {
  const rows = await sql<{ docket_id: string }[]>`
    SELECT identifier_value AS docket_id
    FROM case_identifier
    JOIN legal_case ON legal_case.id = case_identifier.case_id
    JOIN court ON court.id = legal_case.court_id
    WHERE case_identifier.identifier_type = 'courtlistener_docket_id'
      AND case_identifier.provider_id = (SELECT id FROM provider WHERE code = 'courtlistener')
      AND legal_case.publication <> 'restricted'
      AND (
        lower(coalesce(court.jurisdiction, '')) IN ('f', 'fd', 'federal')
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal district%'
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal appellate%'
      )
    ORDER BY legal_case.source_updated_at ASC NULLS FIRST
    LIMIT ${requestedLimit}
  `;
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "active-case-updates",
    selection: { requestedLimit },
    selectedCount: rows.length,
  });
  let updated = 0;
  let failed = 0;
  let docketEntries = 0;
  let documents = 0;
  for (const row of rows) {
    await startIngestionRunItem(sql, runId, row.docket_id);
    try {
      const result = await ingestCourtListenerDocket(
        sql,
        artifactStore,
        Number(row.docket_id),
      );
      updated += 1;
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
      await finishIngestionRunItem(sql, {
        runId,
        sourceRecordId: row.docket_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  await finishIngestionRun(sql, runId);
  return {
    loop,
    runId,
    discovered: rows.length,
    updated,
    docketEntries,
    documents,
    failed,
    costs: 0,
  };
}

async function runMaterialDecisions() {
  const courts = await sql<{ provider_court_id: string }[]>`
    SELECT provider_court_id
    FROM court
    WHERE provider_id = (SELECT id FROM provider WHERE code = 'courtlistener')
      AND provider_court_id IS NOT NULL
      AND (
        lower(coalesce(jurisdiction, '')) IN ('f', 'fd', 'federal')
        OR lower(coalesce(jurisdiction, '')) LIKE '%federal district%'
        OR lower(coalesce(jurisdiction, '')) LIKE '%federal appellate%'
      )
    ORDER BY provider_court_id
  `;
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "material-decisions",
    selection: {
      requestedLimit,
      since: isoDaysAgo(lookbackDays),
      courtCount: courts.length,
    },
    selectedCount: requestedLimit,
  });
  let discovered = 0;
  let opinions = 0;
  let failed = 0;
  for (const court of courts) {
    if (discovered >= requestedLimit) break;
    const ids = await fetchOpinionClusterIds({
      courtCode: court.provider_court_id,
      filedAfter: isoDaysAgo(lookbackDays).slice(0, 10),
      limit: Math.min(100, requestedLimit - discovered),
      order: "newest",
    });
    for (const id of ids) {
      if (discovered >= requestedLimit) break;
      discovered += 1;
      await startIngestionRunItem(sql, runId, String(id));
      try {
        const result = await ingestCourtListenerOpinionCluster(sql, artifactStore, id);
        opinions += result.documents.length;
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: String(id),
          casePublicId: result.caseId,
          documentCount: result.documents.length,
        });
      } catch (error) {
        failed += 1;
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: String(id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  await finishIngestionRun(sql, runId);
  return { loop, runId, discovered, opinions, failed, costs: 0 };
}

async function runPublicationAndQuarantine() {
  const candidates = await sql<{
    id: string;
    caption: string;
    docket_number: string;
    source_artifact_id: string | null;
    unresolved_rejections: number;
    document_count: number;
  }[]>`
    SELECT legal_case.id, legal_case.caption, legal_case.docket_number,
      legal_case.source_artifact_id,
      (SELECT count(*)::int FROM ingestion_rejection rejection
       WHERE rejection.resolved_at IS NULL
         AND rejection.source_record_id = (
           SELECT identifier_value FROM case_identifier
           WHERE case_id = legal_case.id
             AND identifier_type = 'courtlistener_docket_id'
           LIMIT 1
         )) AS unresolved_rejections,
      (SELECT count(*)::int FROM document WHERE case_id = legal_case.id) AS document_count
    FROM legal_case
    JOIN court ON court.id = legal_case.court_id
    WHERE legal_case.publication = 'draft'
      AND (
        lower(coalesce(court.jurisdiction, '')) IN ('f', 'fd', 'federal')
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal district%'
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal appellate%'
      )
    ORDER BY legal_case.created_at
    LIMIT ${requestedLimit}
  `;
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "publication-quarantine",
    selection: { requestedLimit, policy: "federal-publication-v1" },
    selectedCount: candidates.length,
  });
  let published = 0;
  let held = 0;
  for (const candidate of candidates) {
    await startIngestionRunItem(sql, runId, candidate.id);
    const reason = !candidate.source_artifact_id
      ? "missing_source_artifact"
      : !candidate.caption.trim() || !candidate.docket_number.trim()
        ? "missing_stable_identity"
        : isRestrictedDocketText(`${candidate.caption} ${candidate.docket_number}`)
          ? "restricted_or_sensitive"
          : candidate.unresolved_rejections > 0
            ? "unresolved_ingestion_rejection"
            : null;
    if (reason) {
      held += 1;
      await sql`
        UPDATE legal_case SET verification = 'needs_review',
          publication = CASE WHEN ${reason} = 'restricted_or_sensitive'
            THEN 'restricted'::publication_state ELSE publication END,
          updated_at = now()
        WHERE id = ${candidate.id}
      `;
      await finishIngestionRunItem(sql, {
        runId,
        sourceRecordId: candidate.id,
        error: `Held: ${reason}`,
      });
      continue;
    }
    await sql.begin(async (tx) => {
      await tx`
        UPDATE legal_case SET verification = 'verified', publication = 'published',
          updated_at = now()
        WHERE id = ${candidate.id}
      `;
      await tx`
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        )
        SELECT 'legal_case', ${candidate.id}, true, true, true, false, false,
          'deterministic_federal_source_validation', 'federal-publication-v1'
        WHERE NOT COALESCE((
          SELECT displayable FROM publication_decision
          WHERE object_type = 'legal_case' AND object_id = ${candidate.id}
          ORDER BY decided_at DESC, id DESC LIMIT 1
        ), false)
      `;
      await tx`
        INSERT INTO outbox_event (
          topic, aggregate_type, aggregate_id, aggregate_version, payload
        ) VALUES (
          'publication.changed', 'legal_case', ${candidate.id},
          (extract(epoch from clock_timestamp()) * 1000000)::bigint,
          ${tx.json({ source: "courtlistener", policy: "federal-publication-v1" })}
        )
      `;
    });
    published += 1;
    await finishIngestionRunItem(sql, {
      runId,
      sourceRecordId: candidate.id,
      documentCount: candidate.document_count,
    });
  }
  await finishIngestionRun(sql, runId);
  return {
    loop,
    runId,
    discovered: candidates.length,
    published,
    held,
    failed: 0,
    costs: 0,
  };
}

try {
  env();
  const startedAt = Date.now();
  const result = loop === "new-case-discovery" || loop === "historical-backfill"
    ? await runDocketStream(loop)
    : loop === "active-case-updates"
      ? await runActiveUpdates()
      : loop === "material-decisions"
        ? await runMaterialDecisions()
        : await runPublicationAndQuarantine();
  process.stdout.write(`${JSON.stringify({
    ...result,
    executionTimeMs: Date.now() - startedAt,
    completedAt: new Date().toISOString(),
  })}\n`);
} finally {
  await closeDb();
}
