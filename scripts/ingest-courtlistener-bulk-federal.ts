import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import {
  DEFAULT_BULK_BASE_URL,
  ingestCourtListenerBulkFederalOpinions,
} from "@/modules/ingestion/application/ingest-courtlistener-bulk-federal-opinions";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
}

function optionalArgument(name: string): string | undefined {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : undefined;
}

function booleanFlag(name: string): boolean {
  // `--include-bankruptcy` or `--include-bankruptcy=true` both enable it; absent or
  // `=false` leaves it off (bankruptcy is enormous and low-value, so it is opt-in).
  if (process.argv.includes(`--${name}`)) return true;
  const value = optionalArgument(name);
  return value === "true" || value === "1";
}

const snapshotDate = argument("snapshot-date", "").trim();
const baseUrl = argument("base-url", DEFAULT_BULK_BASE_URL).trim();
const minYear = Number(argument("min-year", "1900"));
const maxYearRaw = optionalArgument("max-year");
const maxYear = maxYearRaw === undefined ? undefined : Number(maxYearRaw);
const limitRaw = optionalArgument("limit");
const limit = limitRaw === undefined ? undefined : Number(limitRaw);
const includeBankruptcy = booleanFlag("include-bankruptcy");

if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  throw new Error("--snapshot-date=YYYY-MM-DD is required");
}
if (!Number.isInteger(minYear) || minYear < 1700 || minYear > 2100) {
  throw new Error("--min-year must be an integer from 1700 to 2100");
}
if (maxYear !== undefined && (!Number.isInteger(maxYear) || maxYear < 1700 || maxYear > 2100)) {
  throw new Error("--max-year must be an integer from 1700 to 2100");
}
if (maxYear !== undefined && maxYear < minYear) {
  throw new Error("--max-year must be >= --min-year");
}
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error("--limit must be a positive integer");
}

const sql = db();
// Use the Spaces-aware factory so bulk opinion artifacts land in object storage
// in production (and fail loud if Spaces is misconfigured) rather than silently
// filling the ingestion box's local disk -- the failure mode behind the
// 2026-08-16 100%-full incident.
const artifactRoot = process.env.RAW_ARTIFACT_DIR ?? ".data/raw";
const artifactStore = createArtifactStore({ localRoot: artifactRoot });

try {
  env();
  const result = await ingestCourtListenerBulkFederalOpinions(sql, artifactStore, {
    snapshotDate,
    baseUrl,
    minYear,
    maxYear,
    limit,
    includeBankruptcy,
    onProgress: ({ opinionsWritten, opinionsSkipped }) => {
      console.log(JSON.stringify({
        lane: "courtlistener-bulk-federal",
        progress: true,
        snapshotDate,
        opinionsWritten,
        opinionsSkipped,
      }));
    },
  });
  console.log(JSON.stringify({
    lane: "courtlistener-bulk-federal",
    snapshotDate,
    baseUrl,
    minYear,
    maxYear: maxYear ?? null,
    limit: limit ?? null,
    ...result,
  }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
