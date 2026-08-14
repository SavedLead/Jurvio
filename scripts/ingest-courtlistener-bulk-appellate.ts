import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import {
  DEFAULT_BULK_BASE_URL,
  ingestCourtListenerBulkAppellateOpinions,
} from "@/modules/ingestion/application/ingest-courtlistener-bulk-appellate-opinions";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
}

function optionalArgument(name: string): string | undefined {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : undefined;
}

const snapshotDate = argument("snapshot-date", "").trim();
const baseUrl = argument("base-url", DEFAULT_BULK_BASE_URL).trim();
const minYear = Number(argument("min-year", "1900"));
const limitRaw = optionalArgument("limit");
const limit = limitRaw === undefined ? undefined : Number(limitRaw);

if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  throw new Error("--snapshot-date=YYYY-MM-DD is required");
}
if (!Number.isInteger(minYear) || minYear < 1700 || minYear > 2100) {
  throw new Error("--min-year must be an integer from 1700 to 2100");
}
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error("--limit must be a positive integer");
}

const sql = db();
const artifactRoot = process.env.RAW_ARTIFACT_DIR ?? ".data/raw";
const artifactStore = new LocalArtifactStore(artifactRoot);

try {
  env();
  const result = await ingestCourtListenerBulkAppellateOpinions(sql, artifactStore, {
    snapshotDate,
    baseUrl,
    minYear,
    limit,
    onProgress: ({ opinionsWritten, opinionsSkipped }) => {
      console.log(JSON.stringify({
        lane: "courtlistener-bulk-appellate",
        progress: true,
        snapshotDate,
        opinionsWritten,
        opinionsSkipped,
      }));
    },
  });
  console.log(JSON.stringify({
    lane: "courtlistener-bulk-appellate",
    snapshotDate,
    baseUrl,
    minYear,
    limit: limit ?? null,
    ...result,
  }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
