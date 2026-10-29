import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { importFederalOpinionChunk } from "@/modules/ingestion/application/import-federal-opinion-chunk";
import {
  runFederalChunkImport,
  type ClaimedFederalChunk,
} from "@/modules/ingestion/application/run-federal-chunk-import";
import {
  courtListenerBulkOpinionChunkSchema,
  type CourtListenerBulkOpinion,
} from "@/modules/ingestion/providers/courtlistener/bulk-opinions";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import {
  federalChunkCorpusIsReadable,
  resolveFederalChunkFile,
} from "@/modules/ingestion/domain/federal-chunk-path";

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

function optionalArgument(name: string): string | undefined {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : undefined;
}

const snapshotDate = argument("snapshot-date", process.env.JURVIO_FEDERAL_CHUNK_SNAPSHOT ?? "").trim();
const maxChunksRaw = optionalArgument("max-chunks");
const maxChunks = maxChunksRaw === undefined ? undefined : Number(maxChunksRaw);
const staleMinutes = Number(argument("stale-minutes", "15"));
// `all` is for the sole compose service: a start means the previous process is
// dead, so an `importing` row is abandoned regardless of age. `stale` is the
// manual/shared mode that will not steal a chunk from a live importer.
const reclaimImporting = argument("reclaim-importing", process.env.JURVIO_FEDERAL_CHUNK_RECLAIM ?? "stale");
// How often (in opinions) to flush running progress to the ledger so it is observable
// mid-chunk from a separate read-only query without waiting for the job to finish.
const progressInterval = Number(argument("progress-interval", "200"));

if (snapshotDate === "") {
  console.log(JSON.stringify({ phase: "disabled", reason: "JURVIO_FEDERAL_CHUNK_SNAPSHOT is unset" }));
  process.exit(0);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date=YYYY-MM-DD is required");
if (reclaimImporting !== "stale" && reclaimImporting !== "all") {
  throw new Error("--reclaim-importing must be stale or all");
}
if (maxChunks !== undefined && (!Number.isInteger(maxChunks) || maxChunks < 1)) {
  throw new Error("--max-chunks must be a positive integer");
}
if (!Number.isInteger(staleMinutes) || staleMinutes < 1) throw new Error("--stale-minutes must be a positive integer");
if (!Number.isInteger(progressInterval) || progressInterval < 1) throw new Error("--progress-interval must be a positive integer");

/** Parse one chunk's JSONL.gz back into validated opinion rows, one at a time. */
async function* readChunkOpinions(filePath: string): AsyncGenerator<CourtListenerBulkOpinion> {
  const lines = createInterface({
    input: createReadStream(filePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    // Validate against the PARSED-shape schema: a chunk holds already-typed opinions
    // (booleans, null), not raw CSV strings. Using the CSV schema here was the pilot bug.
    yield courtListenerBulkOpinionChunkSchema.parse(JSON.parse(line)) as CourtListenerBulkOpinion;
  }
}

const sql = db();
const artifactStore = createArtifactStore({ localRoot: process.env.RAW_ARTIFACT_DIR ?? ".data/raw" });

try {
  env();
  const startedAt = Date.now();

  // Recover from a killed importer: any chunk left 'importing' past the stale window is
  // reset to 'failed' so it re-enters the worklist. Idempotent re-imports make this safe.
  const reclaimed = await sql`
    UPDATE federal_import_chunk
    SET status = 'failed',
        last_error = coalesce(last_error, 'reclaimed: importer disconnected mid-chunk'),
        updated_at = now()
    WHERE snapshot_date = ${snapshotDate}
      AND status = 'importing'
      AND (
        ${reclaimImporting === "all"}
        OR updated_at < now() - ${`${staleMinutes} minutes`}::interval
      )
    RETURNING chunk_key
  `;
  if (reclaimed.length > 0) console.log(JSON.stringify({ phase: "reclaim", reclaimed: reclaimed.length, mode: reclaimImporting }));

  // Sample the worklist before claiming. If every sampled file is gone (container
  // recreate wiped the writable layer), leave the ledger untouched.
  const sample = await sql<{ file_path: string }[]>`
    SELECT file_path FROM federal_import_chunk
    WHERE snapshot_date = ${snapshotDate}
      AND status IN ('ready', 'failed')
    ORDER BY chunk_index
    LIMIT 8
  `;
  const corpusReadable = federalChunkCorpusIsReadable(sample.map((row) => row.file_path), existsSync);
  if (!corpusReadable) {
    console.error(JSON.stringify({
      phase: "chunk-files-missing",
      snapshotDate,
      sample: sample.map((row) => row.file_path),
      hint: "No chunk file from the sample is on disk. They were stored on the worker writable layer (/var/lib/jurvio/federal-chunks) and do not survive a container recreate. Re-extract onto /var/lib/jurvio/artifacts/federal-chunks. No chunks were claimed.",
    }));
  }

  const summary = corpusReadable ? await runFederalChunkImport(
    {
      claimNext: async (excludeKeys) => {
        // Claim the next pending chunk NOT already tried this run (excludeKeys), so a
        // failing chunk cannot be re-claimed and spin the run. FOR UPDATE SKIP LOCKED
        // keeps this safe if ever run as multiple importers.
        const [row] = await sql<ClaimedFederalChunk[]>`
          UPDATE federal_import_chunk
          SET status = 'importing', import_started_at = now(), updated_at = now()
          WHERE chunk_key = (
            SELECT chunk_key FROM federal_import_chunk
            WHERE snapshot_date = ${snapshotDate}
              AND status IN ('ready', 'failed')
              AND NOT (chunk_key = ANY(${excludeKeys as string[]}))
            ORDER BY chunk_index
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING chunk_key AS "chunkKey", file_path AS "filePath",
                    record_count AS "recordCount", file_sha256 AS "fileSha256"
        `;
        return row ?? null;
      },
      importChunk: async (chunk) => {
        const resolvedPath = resolveFederalChunkFile(chunk.filePath, existsSync);
        if (!resolvedPath) {
          throw new Error(`chunk file missing: ${chunk.filePath}`);
        }
        if (resolvedPath !== chunk.filePath) {
          await sql`
            UPDATE federal_import_chunk
            SET file_path = ${resolvedPath}, updated_at = now()
            WHERE chunk_key = ${chunk.chunkKey}
          `;
          chunk.filePath = resolvedPath;
        }
        // Verify the file against its recorded sha256 before trusting it (truncated or
        // corrupted extraction is caught here rather than importing partial data).
        const actualSha = createHash("sha256").update(await readFile(chunk.filePath)).digest("hex");
        if (actualSha !== chunk.fileSha256) {
          throw new Error(`sha256 mismatch for ${chunk.filePath}: expected ${chunk.fileSha256}, got ${actualSha}`);
        }
        return importFederalOpinionChunk(sql, artifactStore, readChunkOpinions(chunk.filePath), {
          snapshotDate,
          progressInterval,
          // Flush running progress to this chunk's ledger row so updated_at = last
          // progress time and opinions_written climbs visibly mid-chunk.
          onProgress: (p) => {
            void sql`
              UPDATE federal_import_chunk
              SET opinions_written = ${p.opinionsWritten},
                  opinions_skipped = ${p.opinionsSkippedEmpty + p.opinionsUnmatched},
                  updated_at = now()
              WHERE chunk_key = ${chunk.chunkKey}
            `.catch(() => {});
          },
        });
      },
      markCompleted: async (chunk, result) => {
        await sql`
          UPDATE federal_import_chunk
          SET status = 'completed',
              opinions_written = ${result.opinionsWritten},
              opinions_skipped = ${result.opinionsSkippedEmpty + result.opinionsUnmatched},
              last_error = NULL,
              import_finished_at = now(),
              updated_at = now()
          WHERE chunk_key = ${chunk.chunkKey}
        `;
        console.log(
          JSON.stringify({
            phase: "chunk-completed",
            chunk: chunk.chunkKey,
            opinionsWritten: result.opinionsWritten,
            opinionsSkippedEmpty: result.opinionsSkippedEmpty,
            opinionsUnmatched: result.opinionsUnmatched,
          }),
        );
      },
      markFailed: async (chunk, message) => {
        await sql`
          UPDATE federal_import_chunk
          SET status = 'failed', last_error = ${message.slice(0, 2000)}, updated_at = now()
          WHERE chunk_key = ${chunk.chunkKey}
        `;
        process.stderr.write(`chunk ${chunk.chunkKey} failed: ${message}\n`);
      },
      onProgress: (p) =>
        console.log(
          JSON.stringify({
            phase: "progress",
            attempted: p.attempted,
            completed: p.completed,
            failed: p.failed,
            opinionsWritten: p.opinionsWritten,
            opinionsSkipped: p.opinionsSkipped,
            elapsedMs: Date.now() - startedAt,
          }),
        ),
    },
    { maxChunks },
  ) : {
    attempted: 0,
    completed: 0,
    failed: 0,
    opinionsWritten: 0,
    opinionsSkipped: 0,
  };

  if (!corpusReadable) {
    // Already logged chunk-files-missing. Exit 0 so the service does not restart-loop.
  } else {
  const elapsedMs = Date.now() - startedAt;
  const rate = elapsedMs > 0 ? Math.round((summary.opinionsWritten / elapsedMs) * 1000) : 0;
  console.log(
    JSON.stringify({
      phase: "import-done",
      snapshotDate,
      attempted: summary.attempted,
      completed: summary.completed,
      failed: summary.failed,
      opinionsWritten: summary.opinionsWritten,
      opinionsSkipped: summary.opinionsSkipped,
      elapsedMs,
      opinionsPerSecond: rate,
    }),
  );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
