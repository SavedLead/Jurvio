import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import {
  finishIngestionRun,
  finishIngestionRunItem,
  startIngestionRun,
  startIngestionRunItem,
} from "@/modules/ingestion/application/ingestion-run";
import { ingestCourtListenerOpinionCluster } from "@/modules/ingestion/application/ingest-courtlistener-opinion-cluster";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import {
  APPELLATE_COURT_REGISTRY,
  appellateCourtByCode,
} from "@/modules/ingestion/providers/appellate/registry";
import { fetchOpinionClusterPage } from "@/modules/ingestion/providers/courtlistener/client";

type Checkpoint = {
  court_code: string;
  filing_year: number;
  next_cursor: string | null;
  status: string;
};

type BackfillItem = {
  cluster_id: string;
  court_code: string;
  filing_year: number;
};

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
}

const courtArgument = argument("court", "next").trim().toLowerCase();
const batchSize = Number(argument("batch-size", "20"));
const delayMs = Number(argument("delay-ms", "1000"));
const minimumYear = Number(argument("min-year", "1700"));
const maximumAttempts = Number(argument("maximum-attempts", "10"));
const currentYear = new Date().getUTCFullYear();

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
  throw new Error("--batch-size must be an integer from 1 to 100");
}
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms must be an integer from 0 to 60000");
}
if (!Number.isInteger(minimumYear) || minimumYear < 1700 || minimumYear > currentYear) {
  throw new Error(`--min-year must be an integer from 1700 to ${currentYear}`);
}
if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 100) {
  throw new Error("--maximum-attempts must be an integer from 1 to 100");
}

const sql = db();
const artifactRoot = process.env.RAW_ARTIFACT_DIR ?? ".data/raw";
const artifactStore = new LocalArtifactStore(artifactRoot);
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ensureCurrentYearCheckpoints(): Promise<void> {
  await sql`
    INSERT INTO courtlistener_appellate_checkpoint (court_code, filing_year)
    SELECT court_code, ${currentYear}
    FROM appellate_source_registry
    ON CONFLICT (court_code, filing_year) DO NOTHING
  `;
}

async function resolveCourts(): Promise<string[]> {
  if (courtArgument === "all") {
    return APPELLATE_COURT_REGISTRY.map((court) => court.code);
  }
  if (courtArgument !== "next") {
    const requested = [...new Set(
      courtArgument.split(",").map((value) => value.trim()).filter(Boolean),
    )];
    const unknown = requested.filter((code) => !appellateCourtByCode(code));
    if (unknown.length > 0) {
      throw new Error(`Unknown appellate court(s): ${unknown.join(", ")}`);
    }
    return requested;
  }

  const [next] = await sql<{ court_code: string }[]>`
    SELECT court_code
    FROM courtlistener_appellate_checkpoint
    WHERE status <> 'complete'
      AND filing_year >= ${minimumYear}
    ORDER BY
      updated_at ASC,
      filing_year DESC,
      court_code ASC
    LIMIT 1
  `;
  return next ? [next.court_code] : [];
}

async function activeCheckpoint(courtCode: string): Promise<Checkpoint | null> {
  const [checkpoint] = await sql<Checkpoint[]>`
    SELECT court_code, filing_year, next_cursor, status
    FROM courtlistener_appellate_checkpoint
    WHERE court_code = ${courtCode}
      AND filing_year >= ${minimumYear}
      AND status <> 'complete'
    ORDER BY filing_year DESC
    LIMIT 1
  `;
  return checkpoint ?? null;
}

async function discover(courtCode: string): Promise<{
  court: string;
  year: number | null;
  discovered: number;
  total: number | null;
  pageComplete: boolean;
  error?: string;
}> {
  const checkpoint = await activeCheckpoint(courtCode);
  if (!checkpoint) {
    return { court: courtCode, year: null, discovered: 0, total: null, pageComplete: true };
  }

  const filedAfter = `${checkpoint.filing_year}-01-01`;
  const filedBefore = `${checkpoint.filing_year + 1}-01-01`;
  try {
    const page = await fetchOpinionClusterPage({
      courtCode,
      filedAfter,
      filedBefore,
      cursor: checkpoint.next_cursor ?? undefined,
    });

    for (const clusterId of page.clusterIds) {
      await sql`
        INSERT INTO courtlistener_appellate_backfill_item (
          cluster_id, court_code, filing_year, state
        ) VALUES (
          ${clusterId}, ${courtCode}, ${checkpoint.filing_year}, 'queued'
        )
        ON CONFLICT (cluster_id) DO NOTHING
      `;
    }

    const pageComplete = !page.next || page.next === checkpoint.next_cursor;
    await sql`
      UPDATE courtlistener_appellate_checkpoint SET
        next_cursor = ${pageComplete ? checkpoint.next_cursor : page.next},
        status = ${pageComplete ? "complete" : "running"},
        pages_processed = pages_processed + 1,
        records_discovered = records_discovered + ${page.clusterIds.length},
        consecutive_failures = 0,
        last_successful_retrieval = now(),
        last_error = NULL,
        updated_at = now()
      WHERE court_code = ${courtCode}
        AND filing_year = ${checkpoint.filing_year}
    `;

    if (pageComplete && checkpoint.filing_year > minimumYear) {
      await sql`
        INSERT INTO courtlistener_appellate_checkpoint (court_code, filing_year)
        VALUES (${courtCode}, ${checkpoint.filing_year - 1})
        ON CONFLICT (court_code, filing_year) DO NOTHING
      `;
    }

    return {
      court: courtCode,
      year: checkpoint.filing_year,
      discovered: page.clusterIds.length,
      total: page.total,
      pageComplete,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE courtlistener_appellate_checkpoint SET
        status = 'failed',
        consecutive_failures = consecutive_failures + 1,
        last_error = ${message},
        updated_at = now()
      WHERE court_code = ${courtCode}
        AND filing_year = ${checkpoint.filing_year}
    `;
    return {
      court: courtCode,
      year: checkpoint.filing_year,
      discovered: 0,
      total: null,
      pageComplete: false,
      error: message,
    };
  }
}

async function processQueue(courtCode: string): Promise<{
  selected: number;
  completed: number;
  retried: number;
  blocked: number;
}> {
  await sql`
    UPDATE courtlistener_appellate_backfill_item SET
      state = 'retry',
      last_error = COALESCE(last_error, 'Recovered after interrupted processing'),
      updated_at = now()
    WHERE court_code = ${courtCode}
      AND state = 'processing'
      AND updated_at < now() - interval '30 minutes'
  `;

  const items = await sql<BackfillItem[]>`
    SELECT cluster_id::text, court_code, filing_year
    FROM courtlistener_appellate_backfill_item
    WHERE court_code = ${courtCode}
      AND state IN ('queued', 'retry')
      AND attempts < ${maximumAttempts}
    ORDER BY filing_year DESC, cluster_id DESC
    LIMIT ${batchSize}
  `;

  const runId = await startIngestionRun(sql, {
    providerCode: "courtlistener",
    runType: "appellate_historical_backfill",
    selection: {
      courtCode,
      historicalOrder: "newest-to-oldest",
      batchSize,
      minimumYear,
      maximumAttempts,
    },
    selectedCount: items.length,
  });

  let completed = 0;
  let retried = 0;
  let blocked = 0;
  try {
    for (const [index, item] of items.entries()) {
      await startIngestionRunItem(sql, runId, item.cluster_id);
      await sql`
        UPDATE courtlistener_appellate_backfill_item SET
          state = 'processing',
          attempts = attempts + 1,
          updated_at = now()
        WHERE cluster_id = ${item.cluster_id}
      `;

      try {
        const result = await ingestCourtListenerOpinionCluster(
          sql,
          artifactStore,
          Number(item.cluster_id),
        );
        await sql`
          UPDATE courtlistener_appellate_backfill_item SET
            state = 'complete',
            case_public_id = ${result.caseId},
            document_count = ${result.documents.length},
            last_error = NULL,
            updated_at = now()
          WHERE cluster_id = ${item.cluster_id}
        `;
        await sql`
          UPDATE courtlistener_appellate_checkpoint SET
            records_completed = records_completed + 1,
            updated_at = now()
          WHERE court_code = ${item.court_code}
            AND filing_year = ${item.filing_year}
        `;
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: item.cluster_id,
          casePublicId: result.caseId,
          documentCount: result.documents.length,
        });
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const [updated] = await sql<{ state: string }[]>`
          UPDATE courtlistener_appellate_backfill_item SET
            state = CASE WHEN attempts >= ${maximumAttempts} THEN 'blocked' ELSE 'retry' END,
            last_error = ${message},
            updated_at = now()
          WHERE cluster_id = ${item.cluster_id}
          RETURNING state
        `;
        if (updated?.state === "blocked") blocked += 1;
        else retried += 1;
        await finishIngestionRunItem(sql, {
          runId,
          sourceRecordId: item.cluster_id,
          error: message,
        });
      }

      if (delayMs > 0 && index < items.length - 1) await sleep(delayMs);
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

  return { selected: items.length, completed, retried, blocked };
}

try {
  env();
  await ensureCurrentYearCheckpoints();
  const courts = await resolveCourts();
  const results = [];
  for (const courtCode of courts) {
    const discovery = await discover(courtCode);
    const processing = await processQueue(courtCode);
    results.push({ court: courtCode, discovery, processing });
  }

  console.log(JSON.stringify({
    lane: "courtlistener-appellate-backfill",
    historicalOrder: "newest-to-oldest",
    minimumYear,
    scheduledCourts: courts,
    results,
  }));
} finally {
  await closeDb();
}
