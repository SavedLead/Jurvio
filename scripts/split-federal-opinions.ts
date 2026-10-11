import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { DEFAULT_BULK_BASE_URL } from "@/modules/ingestion/application/ingest-courtlistener-bulk-appellate-opinions";
import { splitFederalOpinions } from "@/modules/ingestion/application/split-federal-opinions";
import {
  openBulkCsvFromUrl,
  readBulkOpinions,
  type CourtListenerBulkOpinion,
} from "@/modules/ingestion/providers/courtlistener/bulk-opinions";

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

const snapshotDate = argument("snapshot-date", "").trim();
const baseUrl = argument("base-url", DEFAULT_BULK_BASE_URL).trim();
const outRoot = argument("out-dir", "/var/lib/jurvio/federal-chunks").trim();
const chunkSize = Number(argument("chunk-size", "25000"));

if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date=YYYY-MM-DD is required");
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 500_000) {
  throw new Error("--chunk-size must be an integer from 1 to 500000");
}

const sql = db();
try {
  env();
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) throw new Error("CourtListener provider seed is missing");

  // Build the bounded set of clusters already ingested in Phase 1; only opinions that
  // point at one of these can be attached, so we chunk only those. Streamed via a
  // server-side cursor so the query itself never buffers all rows client-side.
  const ingestedClusters = new Set<string>();
  for await (const rows of sql<{ provider_cluster_id: string }[]>`
    SELECT provider_cluster_id FROM opinion_cluster WHERE provider_id = ${provider.id}
  `.cursor(50_000)) {
    for (const row of rows) ingestedClusters.add(row.provider_cluster_id);
  }
  if (ingestedClusters.size === 0) {
    throw new Error("No ingested clusters found -- run the Phase 1 case/cluster pass before splitting");
  }
  console.log(JSON.stringify({ phase: "split-start", snapshotDate, ingestedClusters: ingestedClusters.size, chunkSize }));

  const dir = join(outRoot, snapshotDate);
  await mkdir(dir, { recursive: true });

  // Chunk indices already imported (or mid-import). A re-run of extraction must NOT
  // overwrite these files or reset their ledger status -- it reuses them as-is. (The
  // ledger upsert below is also guarded, so even a race cannot reset a completed chunk.)
  const protectedChunks = new Set<number>();
  for (const row of await sql<{ chunk_index: number }[]>`
    SELECT chunk_index FROM federal_import_chunk
    WHERE snapshot_date = ${snapshotDate} AND status IN ('completed', 'importing')
  `) {
    protectedChunks.add(row.chunk_index);
  }
  if (protectedChunks.size > 0) {
    console.log(JSON.stringify({ phase: "reuse", preservedChunks: protectedChunks.size }));
  }

  const source = openBulkCsvFromUrl(`${baseUrl.replace(/\/+$/, "")}/opinions-${snapshotDate}.csv.bz2`);

  const sink = async (chunkIndex: number, records: readonly CourtListenerBulkOpinion[]): Promise<void> => {
    // Preserve an already-imported chunk: skip the file write AND the ledger entirely so
    // its 'completed' status and counts are never reset. The source is still rescanned
    // to reach later chunks (extraction has no byte offset), but completed work is kept.
    if (protectedChunks.has(chunkIndex)) {
      console.log(JSON.stringify({ chunk: chunkIndex, reused: true }));
      return;
    }
    const idx = String(chunkIndex).padStart(6, "0");
    const filePath = join(dir, `opinions-${snapshotDate}-${idx}.jsonl.gz`);
    const tmp = `${filePath}.tmp`;
    // Write to a temp file then rename, so a chunk file only ever appears complete --
    // an interrupted extraction can never leave a half-written chunk the ledger trusts.
    await pipeline(
      Readable.from((function* () {
        for (const record of records) yield `${JSON.stringify(record)}\n`;
      })()),
      createGzip(),
      createWriteStream(tmp),
    );
    const sha256 = createHash("sha256").update(await readFile(tmp)).digest("hex");
    await rename(tmp, filePath);
    // Only refresh a 'ready'/'failed' row; the WHERE guard means a concurrent 'completed'
    // or 'importing' row is left untouched (never reset to 'ready').
    await sql`
      INSERT INTO federal_import_chunk (chunk_key, snapshot_date, chunk_index, file_path, record_count, file_sha256, status)
      VALUES (${`${snapshotDate}/${idx}`}, ${snapshotDate}, ${chunkIndex}, ${filePath}, ${records.length}, ${sha256}, 'ready')
      ON CONFLICT (chunk_key) DO UPDATE SET
        file_path = EXCLUDED.file_path, record_count = EXCLUDED.record_count,
        file_sha256 = EXCLUDED.file_sha256, status = 'ready', opinions_written = 0,
        opinions_skipped = 0, last_error = NULL, extracted_at = now(), updated_at = now()
      WHERE federal_import_chunk.status NOT IN ('completed', 'importing')
    `;
    console.log(JSON.stringify({ chunk: chunkIndex, records: records.length }));
  };

  const result = await splitFederalOpinions(
    readBulkOpinions(source),
    (clusterId) => ingestedClusters.has(clusterId),
    sink,
    {
      chunkSize,
      onProgress: ({ opinionsMatched, chunksWritten }) =>
        console.log(JSON.stringify({ progress: true, opinionsMatched, chunksWritten })),
    },
  );
  console.log(JSON.stringify({ phase: "split-done", snapshotDate, ...result }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
