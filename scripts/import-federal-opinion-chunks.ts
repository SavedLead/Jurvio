import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { importFederalOpinionChunk } from "@/modules/ingestion/application/import-federal-opinion-chunk";
import {
  courtListenerBulkOpinionSchema,
  type CourtListenerBulkOpinion,
} from "@/modules/ingestion/providers/courtlistener/bulk-opinions";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

function optionalArgument(name: string): string | undefined {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : undefined;
}

const snapshotDate = argument("snapshot-date", "").trim();
const maxChunksRaw = optionalArgument("max-chunks");
const maxChunks = maxChunksRaw === undefined ? undefined : Number(maxChunksRaw);
// Minutes after which an 'importing' chunk is assumed abandoned (importer killed
// mid-chunk) and reclaimed back to 'failed' so the next run retries it.
const staleMinutes = Number(argument("stale-minutes", "15"));

if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date=YYYY-MM-DD is required");
if (maxChunks !== undefined && (!Number.isInteger(maxChunks) || maxChunks < 1)) {
  throw new Error("--max-chunks must be a positive integer");
}
if (!Number.isInteger(staleMinutes) || staleMinutes < 1) {
  throw new Error("--stale-minutes must be a positive integer");
}

/** Parse one chunk's JSONL.gz back into validated opinion rows, one at a time. */
async function* readChunkOpinions(filePath: string): AsyncGenerator<CourtListenerBulkOpinion> {
  const lines = createInterface({
    input: createReadStream(filePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    yield courtListenerBulkOpinionSchema.parse(JSON.parse(line));
  }
}

const sql = db();
const artifactStore = createArtifactStore({ localRoot: process.env.RAW_ARTIFACT_DIR ?? ".data/raw" });

try {
  env();

  // Recover from a killed importer: any chunk left 'importing' past the stale window is
  // reset to 'failed' so it re-enters the worklist. Idempotent re-imports make this safe
  // even if the earlier run had already written some of the chunk's opinions.
  const reclaimed = await sql`
    UPDATE federal_import_chunk
    SET status = 'failed',
        last_error = coalesce(last_error, 'reclaimed: importer disconnected mid-chunk'),
        updated_at = now()
    WHERE snapshot_date = ${snapshotDate}
      AND status = 'importing'
      AND updated_at < now() - ${`${staleMinutes} minutes`}::interval
    RETURNING chunk_key
  `;
  if (reclaimed.length > 0) {
    console.log(JSON.stringify({ phase: "reclaim", reclaimed: reclaimed.length }));
  }

  let processed = 0;
  let totalWritten = 0;
  for (;;) {
    if (maxChunks !== undefined && processed >= maxChunks) break;

    // Atomically claim the next pending chunk. FOR UPDATE SKIP LOCKED makes this safe to
    // run as multiple importers in parallel (each claims a distinct chunk); we run one.
    const [chunk] = await sql<
      { chunk_key: string; file_path: string; record_count: number; file_sha256: string }[]
    >`
      UPDATE federal_import_chunk
      SET status = 'importing', import_started_at = now(), updated_at = now()
      WHERE chunk_key = (
        SELECT chunk_key FROM federal_import_chunk
        WHERE snapshot_date = ${snapshotDate} AND status IN ('ready', 'failed')
        ORDER BY chunk_index
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING chunk_key, file_path, record_count, file_sha256
    `;
    if (!chunk) break;

    const startedAt = Date.now();
    try {
      // Verify the chunk file against the sha256 recorded at extraction, so a truncated
      // or corrupted file is caught before we trust it rather than importing partial data.
      const actualSha = createHash("sha256").update(await readFile(chunk.file_path)).digest("hex");
      if (actualSha !== chunk.file_sha256) {
        throw new Error(
          `sha256 mismatch for ${chunk.file_path}: expected ${chunk.file_sha256}, got ${actualSha}`,
        );
      }

      const res = await importFederalOpinionChunk(sql, artifactStore, readChunkOpinions(chunk.file_path), {
        snapshotDate,
      });

      const elapsedMs = Date.now() - startedAt;
      await sql`
        UPDATE federal_import_chunk
        SET status = 'completed',
            opinions_written = ${res.opinionsWritten},
            opinions_skipped = ${res.opinionsSkippedEmpty + res.opinionsUnmatched},
            last_error = NULL,
            import_finished_at = now(),
            updated_at = now()
        WHERE chunk_key = ${chunk.chunk_key}
      `;
      processed += 1;
      totalWritten += res.opinionsWritten;
      const rate = elapsedMs > 0 ? Math.round((res.opinionsWritten / elapsedMs) * 1000) : 0;
      console.log(
        JSON.stringify({
          chunk: chunk.chunk_key,
          opinionsWritten: res.opinionsWritten,
          opinionsSkippedEmpty: res.opinionsSkippedEmpty,
          opinionsUnmatched: res.opinionsUnmatched,
          elapsedMs,
          opinionsPerSecond: rate,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Mark this chunk 'failed' and move on: one bad chunk must not stop the run, and a
      // failed chunk is retried (idempotently) on the next invocation.
      await sql`
        UPDATE federal_import_chunk
        SET status = 'failed', last_error = ${message.slice(0, 2000)}, updated_at = now()
        WHERE chunk_key = ${chunk.chunk_key}
      `;
      process.stderr.write(`chunk ${chunk.chunk_key} failed: ${message}\n`);
    }
  }

  console.log(JSON.stringify({ phase: "import-done", snapshotDate, chunksProcessed: processed, totalWritten }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
