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
  classifyFailureSignal,
  runAdaptiveWorkerPool,
} from "@/modules/ingestion/application/adaptive-worker-pool";
import {
  initialConcurrencyState,
  resolveAdaptiveConfig,
  type AdaptiveConcurrencyConfig,
  type AdaptiveConcurrencyState,
  type OutcomeSignal,
} from "@/modules/ingestion/domain/adaptive-concurrency";
import {
  decodeStreamCursor,
  encodeStreamCursor,
  evaluateFederalPublicationCandidate,
  FEDERAL_PUBLICATION_RULE_VERSION,
  isNonBankruptcyFederalJurisdiction,
  isRestrictedDocketText,
  LEGACY_CURSOR_BATCH_SIZE,
  orderFederalCourtsByPriority,
  type FederalLoop,
  type StreamCursor,
} from "@/modules/ingestion/domain/federal-stream";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import {
  fetchDocketPage,
  fetchOpinionClusterIds,
} from "@/modules/ingestion/providers/courtlistener/client";
import { publishCaseOpinionDocuments } from "@/modules/ingestion/application/publish-federal-opinion-documents";

function option(name: string, fallback: string): string {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/** Resolve an integer from a CLI flag, then an env var, then a default. */
function intSetting(flag: string, envName: string, fallback: number): number {
  const raw = option(flag, process.env[envName] ?? String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

// --- Adaptive concurrency + runaway safety bounds -------------------------------
//
// The federal loops used to be throttled by a fixed 100-item ceiling and a forced
// 1s sleep per item. That is replaced by a bounded, self-throttling worker pool.
//
// Concurrency starts conservative and is governed at runtime by the adaptive
// controller (halves on distress, recovers +1 after clean windows). We additionally
// clamp the pool's ceiling to an absolute hard max so no env/flag can push the small
// production droplet toward the OOM (exit 137) failures it has hit before.
const FEDERAL_HARD_MAX_CONCURRENCY = 16;
const FEDERAL_DEFAULT_MAX_CONCURRENCY = 8;
const FEDERAL_DEFAULT_START_CONCURRENCY = 6;
// Runaway guard: an upper bound on items processed per cycle so a huge eligible queue
// can never run unbounded. This is a high, finite safety net, NOT an artificial batch
// limit — the loop normally stops when the eligible queue for the cycle is drained.
const FEDERAL_DEFAULT_RUNAWAY_ITEM_LIMIT = 5_000;
const FEDERAL_ABSOLUTE_RUNAWAY_ITEM_LIMIT = 100_000;

// Per-court discovery cap for material-decisions so no single busy court can hoard the
// whole cycle before other (lower-priority but still eligible) courts get any service.
const MATERIAL_PER_COURT_DISCOVERY_CAP = 250;
// Publication is pure DB work; drain it in bounded chunks so we never hold thousands of
// rich candidate rows in memory at once.
const PUBLICATION_CHUNK_SIZE = 250;

const loop = option("loop", "new-case-discovery") as FederalLoop;
const lookbackDays = Number(option("lookback-days", "2"));

const maxConcurrency = Math.max(
  1,
  Math.min(
    FEDERAL_HARD_MAX_CONCURRENCY,
    intSetting("max-concurrency", "FEDERAL_MAX_CONCURRENCY", FEDERAL_DEFAULT_MAX_CONCURRENCY),
  ),
);
const startConcurrency = Math.max(
  1,
  Math.min(
    maxConcurrency,
    intSetting("start-concurrency", "FEDERAL_START_CONCURRENCY", FEDERAL_DEFAULT_START_CONCURRENCY),
  ),
);
const runawayItemLimit = Math.max(
  1,
  Math.min(
    FEDERAL_ABSOLUTE_RUNAWAY_ITEM_LIMIT,
    intSetting("max-items", "FEDERAL_RUNAWAY_ITEM_LIMIT", FEDERAL_DEFAULT_RUNAWAY_ITEM_LIMIT),
  ),
);

const adaptiveConfig: AdaptiveConcurrencyConfig = resolveAdaptiveConfig({
  start: startConcurrency,
  max: maxConcurrency,
});

const allowedLoops: FederalLoop[] = [
  "new-case-discovery",
  "active-case-updates",
  "material-decisions",
  "historical-backfill",
  "publication-quarantine",
];
if (!allowedLoops.includes(loop)) throw new Error("--loop is invalid");
if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
  throw new Error("--lookback-days must be 1-365");
}

const sql = db();
const artifactStore = createArtifactStore({
  localRoot: process.env.RAW_ARTIFACT_DIR ?? process.env.JURVIO_ARTIFACT_ROOT ?? ".data/raw",
});

const concurrencySelection = {
  startConcurrency: adaptiveConfig.start,
  maxConcurrency: adaptiveConfig.max,
  runawayItemLimit,
};

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

/** Iterate an in-memory array through the adaptive pool, threading controller state. */
async function processArrayWithPool<T>(
  items: readonly T[],
  handle: (item: T) => Promise<OutcomeSignal>,
  state: AdaptiveConcurrencyState,
): Promise<AdaptiveConcurrencyState> {
  let cursor = 0;
  const result = await runAdaptiveWorkerPool<T>({
    config: adaptiveConfig,
    initialState: state,
    pull: async () => (cursor < items.length ? items[cursor++] : undefined),
    handle,
  });
  return result.finalState;
}

async function runDocketStream(kind: "new-case-discovery" | "historical-backfill") {
  const now = new Date().toISOString();
  const fallback: StreamCursor = kind === "new-case-discovery"
    ? {
        version: 1,
        windowStart: isoDaysAgo(lookbackDays),
        windowEnd: now,
        next: null,
        batchSize: LEGACY_CURSOR_BATCH_SIZE,
        completedWindows: 0,
      }
    : {
        version: 1,
        windowStart: "2000-01-01T00:00:00.000Z",
        windowEnd: "2001-01-01T00:00:00.000Z",
        next: null,
        batchSize: LEGACY_CURSOR_BATCH_SIZE,
        completedWindows: 0,
      };
  const streamName = kind === "historical-backfill"
    ? "federal:historical-backfill:v2:filed"
    : "federal:new-case-discovery:v1";
  const checkpoint = await readCheckpoint(streamName, fallback);
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: kind,
    selection: { ...checkpoint, ...concurrencySelection },
    selectedCount: runawayItemLimit,
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
  // Adaptive concurrency state is threaded across pages so distress on page N carries
  // into page N+1 (the controller does not reset just because a page boundary is crossed).
  let controllerState = initialConcurrencyState(adaptiveConfig);

  async function processDocketRecord(
    retrieved: Awaited<ReturnType<typeof fetchDocketPage>>["records"][number],
  ): Promise<OutcomeSignal> {
    discovered += 1;
    const sourceId = String(retrieved.record.id);
    try {
      await startIngestionRunItem(sql, runId, sourceId);
      if (!(await courtIsFederal(retrieved.record.court))) {
        held += 1;
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: sourceId,
          error: "Held: court is not a verified non-bankruptcy federal jurisdiction",
        });
        return { ok: true };
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
        return { ok: true };
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
      const result = await ingestCourtListenerDocket(sql, artifactStore, retrieved.record.id);
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
      return { ok: true };
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await finishIngestionRunItem(sql, { runId, sourceRecordId: sourceId, error: message })
        .catch(() => undefined);
      return { ok: false, ...classifyFailureSignal(error) };
    }
  }

  try {
    // Process page-by-page: each page is drained through the adaptive pool before the
    // durable cursor advances, so a crash never skips an unprocessed page (upserts are
    // idempotent, so at-least-once re-processing is safe). We keep going until the source
    // window is exhausted OR the runaway safety bound is reached.
    let courtlistenerUnauthorized = false;
    while (discovered < runawayItemLimit) {
      let page: Awaited<ReturnType<typeof fetchDocketPage>>;
      try {
        page = await fetchDocketPage(kind === "historical-backfill"
          ? {
              filedAfter: checkpoint.windowStart.slice(0, 10),
              filedBefore: checkpoint.windowEnd.slice(0, 10),
              cursor: next ?? undefined,
            }
          : {
              modifiedAfter: checkpoint.windowStart,
              modifiedBefore: checkpoint.windowEnd,
              cursor: next ?? undefined,
            });
      } catch (error) {
        // CourtListener's docket API requires authentication. Without a valid
        // COURTLISTENER_API_TOKEN on the box every request 401s; treat that as a clean
        // "nothing to do this cycle" and stop WITHOUT advancing the cursor, so ingestion
        // resumes from the same window once the token is set — instead of crash-looping
        // the lane (exit 1) every cycle.
        if (error instanceof Error && /CourtListener request failed:/.test(error.message)) {
          process.stderr.write(
            "CourtListener docket request failed after retries (401/timeout/network); ending this cycle cleanly without advancing the cursor. Set/verify COURTLISTENER_API_TOKEN or COURTLISTENER_TIMEOUT_MS if this persists.\n",
          );
          courtlistenerUnauthorized = true;
          break;
        }
        throw error;
      }
      sourceTotal ??= page.total;
      if (page.records.length === 0) {
        next = null;
        break;
      }

      const remaining = runawayItemLimit - discovered;
      const pageItems = page.records.slice(0, remaining);
      controllerState = await processArrayWithPool(pageItems, processDocketRecord, controllerState);

      next = page.next;
      await writeCheckpoint(streamName, { ...checkpoint, next });
      if (!next) break;
    }

    if (courtlistenerUnauthorized) {
      // Preserve the cursor unchanged so no window is skipped while unauthenticated.
      await writeCheckpoint(streamName, checkpoint);
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
        sourceTotal: sourceTotal ?? null,
        checkpoint,
        finalConcurrency: controllerState.concurrency,
        remainingEstimate: null,
        costs: 0,
        courtlistenerUnauthorized: true,
      };
    }

    const completedWindow = next === null;
    const nextCursor: StreamCursor = completedWindow
      ? kind === "new-case-discovery"
        ? {
            version: 1,
            windowStart: checkpoint.windowEnd,
            windowEnd: new Date().toISOString(),
            next: null,
            batchSize: LEGACY_CURSOR_BATCH_SIZE,
            completedWindows: checkpoint.completedWindows + 1,
          }
        : {
            version: 1,
            windowStart: checkpoint.windowEnd,
            windowEnd: new Date(
              new Date(checkpoint.windowEnd).getTime() + 365 * 86_400_000,
            ).toISOString(),
            next: null,
            batchSize: LEGACY_CURSOR_BATCH_SIZE,
            completedWindows: checkpoint.completedWindows + 1,
          }
      : { ...checkpoint, next };
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
      finalConcurrency: controllerState.concurrency,
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
    LIMIT ${runawayItemLimit}
  `;
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "active-case-updates",
    selection: concurrencySelection,
    selectedCount: rows.length,
  });
  let updated = 0;
  let failed = 0;
  let docketEntries = 0;
  let documents = 0;

  async function handle(row: { docket_id: string }): Promise<OutcomeSignal> {
    try {
      await startIngestionRunItem(sql, runId, row.docket_id);
      const result = await ingestCourtListenerDocket(sql, artifactStore, Number(row.docket_id));
      updated += 1;
      docketEntries += result.docketEntries.accepted;
      documents += result.docketEntries.documents;
      await finishIngestionRunItem(sql, {
        runId,
        sourceRecordId: row.docket_id,
        casePublicId: result.caseId,
        documentCount: result.docketEntries.documents,
      });
      return { ok: true };
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await finishIngestionRunItem(sql, { runId, sourceRecordId: row.docket_id, error: message })
        .catch(() => undefined);
      return { ok: false, ...classifyFailureSignal(error) };
    }
  }

  const finalState = await processArrayWithPool(
    rows,
    handle,
    initialConcurrencyState(adaptiveConfig),
  );
  await finishIngestionRun(sql, runId);
  return {
    loop,
    runId,
    discovered: rows.length,
    updated,
    docketEntries,
    documents,
    failed,
    finalConcurrency: finalState.concurrency,
    costs: 0,
  };
}

async function runMaterialDecisions() {
  // Rank courts SCOTUS -> circuits -> districts (busiest-first). SCOTUS also has its own
  // dedicated lane; ranking it first here is defensive. "Busiest" = recent docket-entry
  // volume, computed in one pass so a hot district is serviced before a quiet one.
  const courts = await sql<{
    provider_court_id: string;
    jurisdiction: string | null;
    recent_event_volume: number;
  }[]>`
    WITH recent AS (
      SELECT legal_case.court_id, count(*)::int AS volume
      FROM docket_entry
      JOIN legal_case ON legal_case.id = docket_entry.case_id
      WHERE docket_entry.created_at >= now() - interval '30 days'
      GROUP BY legal_case.court_id
    )
    SELECT court.provider_court_id,
      court.jurisdiction,
      coalesce(recent.volume, 0) AS recent_event_volume
    FROM court
    LEFT JOIN recent ON recent.court_id = court.id
    WHERE court.provider_id = (SELECT id FROM provider WHERE code = 'courtlistener')
      AND court.provider_court_id IS NOT NULL
      AND (
        lower(coalesce(court.jurisdiction, '')) IN ('f', 'fd', 'federal')
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal district%'
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal appellate%'
      )
  `;
  const orderedCourts = orderFederalCourtsByPriority(
    courts.map((court) => ({
      providerCourtId: court.provider_court_id,
      jurisdiction: court.jurisdiction,
      recentEventVolume: court.recent_event_volume,
    })),
  );

  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "material-decisions",
    selection: {
      ...concurrencySelection,
      since: isoDaysAgo(lookbackDays),
      courtCount: orderedCourts.length,
    },
    selectedCount: runawayItemLimit,
  });

  // Discover cluster ids in priority order, capped per court and by the runaway bound.
  const filedAfter = isoDaysAgo(lookbackDays).slice(0, 10);
  const clusterIds: number[] = [];
  for (const court of orderedCourts) {
    if (clusterIds.length >= runawayItemLimit) break;
    const remaining = runawayItemLimit - clusterIds.length;
    const ids = await fetchOpinionClusterIds({
      courtCode: court.providerCourtId,
      filedAfter,
      limit: Math.min(MATERIAL_PER_COURT_DISCOVERY_CAP, remaining),
      order: "newest",
    });
    for (const id of ids) clusterIds.push(id);
  }

  let opinions = 0;
  let failed = 0;

  async function handle(id: number): Promise<OutcomeSignal> {
    try {
      await startIngestionRunItem(sql, runId, String(id));
      const result = await ingestCourtListenerOpinionCluster(sql, artifactStore, id);
      opinions += result.documents.length;
      await finishIngestionRunItem(sql, {
        runId,
        sourceRecordId: String(id),
        casePublicId: result.caseId,
        documentCount: result.documents.length,
      });
      return { ok: true };
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await finishIngestionRunItem(sql, { runId, sourceRecordId: String(id), error: message })
        .catch(() => undefined);
      return { ok: false, ...classifyFailureSignal(error) };
    }
  }

  const finalState = await processArrayWithPool(
    clusterIds,
    handle,
    initialConcurrencyState(adaptiveConfig),
  );
  await finishIngestionRun(sql, runId);
  return {
    loop,
    runId,
    discovered: clusterIds.length,
    opinions,
    failed,
    finalConcurrency: finalState.concurrency,
    costs: 0,
  };
}

type PublicationCandidate = {
  id: string;
  caption: string;
  docket_number: string;
  source_artifact_id: string | null;
  court_jurisdiction: string | null;
  court_provider_id: string | null;
  court_verification: string | null;
  source_provider_code: string | null;
  source_record_id: string | null;
  source_uri: string | null;
  source_content_hash: string | null;
  source_retrieved_at: string | null;
  canonical_identifier: string | null;
  canonical_identifier_count: number;
  identity_collision_count: number;
  unresolved_rejections: number;
  has_readable_content: boolean;
  document_count: number;
  restricted_text: string;
  provider_scoped_identifier: string | null;
  source_record_resolves_identity: boolean;
  court_case_linkage_verified: boolean;
};

async function selectPublicationCandidates(limit: number): Promise<PublicationCandidate[]> {
  return await sql<PublicationCandidate[]>`
    SELECT legal_case.id, legal_case.caption, legal_case.docket_number,
      legal_case.source_artifact_id,
      court.jurisdiction AS court_jurisdiction,
      court.provider_court_id AS court_provider_id,
      court.verification::text AS court_verification,
      source_provider.code AS source_provider_code,
      source_artifact.source_record_id,
      source_artifact.source_uri,
      source_artifact.content_hash AS source_content_hash,
      source_artifact.retrieved_at::text AS source_retrieved_at,
      canonical.identifier_value AS canonical_identifier,
      (SELECT count(*)::int FROM case_identifier identifier
       WHERE identifier.case_id = legal_case.id
         AND identifier.provider_id = source_provider.id
         AND identifier.identifier_type = 'courtlistener_docket_id'
      ) AS canonical_identifier_count,
      (SELECT count(*)::int FROM legal_case collision
       WHERE collision.court_id = legal_case.court_id
         AND nullif(trim(collision.docket_number), '') IS NOT NULL
         AND lower(trim(collision.docket_number)) = lower(trim(legal_case.docket_number))
      ) AS identity_collision_count,
      (SELECT count(*)::int FROM ingestion_rejection rejection
       WHERE rejection.resolved_at IS NULL
         AND rejection.source_record_id = canonical.identifier_value
      ) AS unresolved_rejections,
      (
        EXISTS(SELECT 1 FROM docket_entry entry WHERE entry.case_id = legal_case.id)
        OR EXISTS(SELECT 1 FROM document doc WHERE doc.case_id = legal_case.id)
        OR EXISTS(
          SELECT 1 FROM judicial_opinion opinion
          JOIN document opinion_doc ON opinion_doc.id = opinion.document_id
          JOIN document_content opinion_content
            ON opinion_content.document_id = opinion.document_id
          WHERE opinion_doc.case_id = legal_case.id
            AND length(btrim(opinion_content.content_text)) > 0
        )
      ) AS has_readable_content,
      (SELECT count(*)::int FROM document WHERE case_id = legal_case.id) AS document_count,
      concat_ws(' ', legal_case.caption, legal_case.docket_number,
        (SELECT string_agg(coalesce(entry.description, ''), ' ')
         FROM docket_entry entry WHERE entry.case_id = legal_case.id),
        (SELECT string_agg(coalesce(document.title, ''), ' ')
         FROM document WHERE document.case_id = legal_case.id)
      ) AS restricted_text,
      -- Validated alternative identity (for docket-less records): the provider-scoped CL
      -- docket id, whether it resolves to the retrieved source record, and whether the
      -- court/case linkage is verified via a provider-scoped case identifier.
      canonical.identifier_value AS provider_scoped_identifier,
      (source_artifact.source_record_id IS NOT NULL
        AND source_artifact.source_record_id = canonical.identifier_value) AS source_record_resolves_identity,
      (court.provider_court_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM case_identifier link
        WHERE link.case_id = legal_case.id
          AND link.provider_id = source_provider.id
          AND link.identifier_type = 'courtlistener_docket_id'
      )) AS court_case_linkage_verified
    FROM legal_case
    JOIN court ON court.id = legal_case.court_id
    LEFT JOIN raw_artifact source_artifact ON source_artifact.id = legal_case.source_artifact_id
    LEFT JOIN provider source_provider ON source_provider.id = source_artifact.provider_id
    LEFT JOIN LATERAL (
      SELECT identifier_value
      FROM case_identifier
      WHERE case_id = legal_case.id
        AND provider_id = source_provider.id
        AND identifier_type = 'courtlistener_docket_id'
      ORDER BY identifier_value
      LIMIT 1
    ) canonical ON true
    WHERE legal_case.publication = 'draft'
      -- Skip a case only while it is held under the CURRENT rule version. A case held by
      -- an older rule (or by the pre-table gate, which left no hold row) is re-evaluated
      -- once under the new rule -- so a gate improvement (e.g. the court registry fix)
      -- lets previously held-but-now-eligible cases publish instead of being suppressed
      -- forever. Restricted cases have publication<>'draft' and are already excluded above.
      AND NOT EXISTS (
        SELECT 1 FROM federal_publication_hold hold
        WHERE hold.case_id = legal_case.id
          AND hold.rule_version = ${FEDERAL_PUBLICATION_RULE_VERSION}
      )
      AND (
        -- Select the federal jurisdiction classes (including 'fs' specialized and 'fbp'
        -- bankruptcy appellate panels) OR any registry-verified court. The gate still
        -- applies every check, so non-court 'fs' tribunals selected here are held, not
        -- published; verified-court selection ensures specialized/historical courts
        -- (Tax Court, Board of Tax Appeals, Customs Court, ...) are reached.
        lower(coalesce(court.jurisdiction, '')) IN ('f', 'fd', 'fb', 'fbp', 'fs', 'federal')
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal district%'
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal appellate%'
        OR lower(coalesce(court.jurisdiction, '')) LIKE '%bankruptcy%'
        OR court.verification = 'verified'
      )
    ORDER BY legal_case.created_at
    LIMIT ${limit}
  `;
}

async function runPublicationAndQuarantine() {
  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "publication-quarantine",
    selection: { ...concurrencySelection, policy: "federal-publication-v2" },
    selectedCount: runawayItemLimit,
  });
  let discovered = 0;
  let published = 0;
  let held = 0;
  let failed = 0;
  let publishedDocuments = 0;
  let heldDocuments = 0;
  const holdReasons: Record<string, number> = {};
  const documentHoldReasons: Record<string, number> = {};
  let controllerState = initialConcurrencyState(adaptiveConfig);

  async function handle(candidate: PublicationCandidate): Promise<OutcomeSignal> {
    try {
      await startIngestionRunItem(sql, runId, candidate.id);
      const decision = evaluateFederalPublicationCandidate({
        caption: candidate.caption,
        docketNumber: candidate.docket_number,
        courtJurisdiction: candidate.court_jurisdiction,
        courtProviderId: candidate.court_provider_id,
        courtVerification: candidate.court_verification,
        sourceArtifactId: candidate.source_artifact_id,
        sourceProviderCode: candidate.source_provider_code,
        sourceRecordId: candidate.source_record_id,
        sourceUri: candidate.source_uri,
        sourceContentHash: candidate.source_content_hash,
        sourceRetrievedAt: candidate.source_retrieved_at,
        hasReadableContent: candidate.has_readable_content,
        canonicalIdentifier: candidate.canonical_identifier,
        canonicalIdentifierCount: candidate.canonical_identifier_count,
        identityCollisionCount: candidate.identity_collision_count,
        unresolvedRejections: candidate.unresolved_rejections,
        restrictedText: candidate.restricted_text,
        providerScopedIdentifier: candidate.provider_scoped_identifier,
        sourceRecordResolvesIdentity: candidate.source_record_resolves_identity,
        courtCaseLinkageVerified: candidate.court_case_linkage_verified,
      });
      if (!decision.eligible) {
        held += 1;
        for (const reason of decision.reasons) {
          holdReasons[reason] = (holdReasons[reason] ?? 0) + 1;
        }
        await sql.begin(async (tx) => {
          await tx`
            UPDATE legal_case SET verification = 'needs_review',
              publication = CASE WHEN ${decision.restricted}
                THEN 'restricted'::publication_state ELSE publication END,
              updated_at = now()
            WHERE id = ${candidate.id}
          `;
          // Record the hold with the CURRENT rule version so this case is skipped until the
          // rule changes again, then re-evaluated once. Mirrors citation_publication_hold.
          await tx`
            INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
            VALUES (${candidate.id}, ${decision.reasons}, ${FEDERAL_PUBLICATION_RULE_VERSION})
            ON CONFLICT (case_id) DO UPDATE SET
              reasons = EXCLUDED.reasons, rule_version = EXCLUDED.rule_version, held_at = now()
          `;
        });
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: candidate.id,
          error: `Held: ${decision.reasons.join(",")}`,
        });
        return { ok: true };
      }
      await sql.begin(async (tx) => {
        await tx`
          UPDATE legal_case SET verification = 'verified', publication = 'published',
            updated_at = now()
          WHERE id = ${candidate.id}
        `;
        // A published case is no longer held; drop any stale hold row so a future rule
        // change starts it fresh rather than seeing a current-rule hold.
        await tx`DELETE FROM federal_publication_hold WHERE case_id = ${candidate.id}`;
        await tx`
          INSERT INTO publication_decision (
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version
          )
          SELECT 'legal_case', ${candidate.id}, true, true, true, false, false,
            'deterministic_federal_source_validation', ${FEDERAL_PUBLICATION_RULE_VERSION}
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
            ${tx.json({ source: "courtlistener", policy: "federal-publication-v2" })}
          )
        `;
        // Extend the deterministic path from case-only to case + opinion document, reusing
        // the shared opinion-document checks. Publishing the case is unchanged above; the
        // document step is additive, idempotent, and holds (never publishes) documents that
        // fail a document-level check. See publishCaseOpinionDocuments for the contract.
        const docResult = await publishCaseOpinionDocuments(tx, candidate.id);
        publishedDocuments += docResult.published;
        heldDocuments += docResult.held;
        for (const [reason, count] of Object.entries(docResult.holdReasons)) {
          documentHoldReasons[reason] = (documentHoldReasons[reason] ?? 0) + count;
        }
      });
      published += 1;
      await finishIngestionRunItem(sql, {
        runId,
        sourceRecordId: candidate.id,
        documentCount: candidate.document_count,
      });
      return { ok: true };
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await finishIngestionRunItem(sql, { runId, sourceRecordId: candidate.id, error: message })
        .catch(() => undefined);
      return { ok: false, ...classifyFailureSignal(error) };
    }
  }

  try {
    // Drain in bounded chunks. Every processed row leaves the draft/not-needs_review
    // predicate (it becomes published or needs_review), so the same LIMITed query
    // returns the next slice each pass until the queue is empty or the runaway cap hits.
    while (discovered < runawayItemLimit) {
      const chunkSize = Math.min(PUBLICATION_CHUNK_SIZE, runawayItemLimit - discovered);
      const candidates = await selectPublicationCandidates(chunkSize);
      if (candidates.length === 0) break;
      discovered += candidates.length;
      controllerState = await processArrayWithPool(candidates, handle, controllerState);
    }
    await finishIngestionRun(sql, runId);
    return {
      loop,
      runId,
      discovered,
      published,
      held,
      holdReasons,
      publishedDocuments,
      heldDocuments,
      documentHoldReasons,
      failed,
      finalConcurrency: controllerState.concurrency,
      costs: 0,
    };
  } catch (error) {
    await finishIngestionRun(sql, runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
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
} catch (error) {
  // CourtListener's opinion/docket APIs require authentication. Without a valid
  // COURTLISTENER_API_TOKEN on the box every request 401s. Whichever loop hit it
  // (material-decisions and active-case-updates fetch opinion clusters via a
  // different path than runDocketStream), treat it as a clean "nothing to do this
  // cycle" and exit 0 — the durable cursor is never advanced past the failed page,
  // so ingestion resumes from the same point once the token is set — instead of
  // crash-looping the lane every cycle.
  if (error instanceof Error && /CourtListener request failed:/.test(error.message)) {
    process.stderr.write(
      "CourtListener request failed after retries (401/timeout/network); ending this cycle cleanly. Set/verify COURTLISTENER_API_TOKEN or COURTLISTENER_TIMEOUT_MS if this persists.\n",
    );
    process.stdout.write(`${JSON.stringify({
      loop,
      courtlistenerUnauthorized: true,
      completedAt: new Date().toISOString(),
    })}\n`);
  } else {
    throw error;
  }
} finally {
  await closeDb();
}
