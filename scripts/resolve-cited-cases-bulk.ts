import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import {
  fetchNewestBulkSnapshot,
  markIngestedResolvedCitations,
  resolveMissingCitationsFromBulk,
  resolvedClusterIds,
} from "@/modules/citations/application/resolve-missing-citations-bulk";
import {
  DEFAULT_BULK_BASE_URL,
  ingestCourtListenerBulkOpinions,
} from "@/modules/ingestion/application/ingest-courtlistener-bulk-appellate-opinions";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { readFederalCourtCodes } from "@/modules/ingestion/providers/courtlistener/bulk-courts";
import { openBulkCsvFromUrl } from "@/modules/ingestion/providers/courtlistener/bulk-opinions";

// Resolve cited-but-missing cases from CourtListener's free bulk data, with no
// API calls and no rate limit.
//
//   --snapshot-date=YYYY-MM-DD  bulk snapshot (required; "latest" = newest
//                               non-empty citations file in the bucket)
//   --import                    also ingest resolved cases from the bulk opinion
//                               files in one pass (hours: streams the full files)
//   --import-limit=N            cap clusters per import run (default 50000)
//   --any-court                 import cited cases from any court, not only
//                               federal (SCOTUS is always excluded: it comes from
//                               official Supreme Court sources)
//
// Publication is unchanged: imported cases are drafts until the existing
// cited-opinion publication gate approves them.
function argument(name: string): string | undefined {
  const value = process.argv.find(entry => entry.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`) || ["1", "true"].includes(argument(name) ?? "");

const baseUrl = (argument("base-url") ?? DEFAULT_BULK_BASE_URL).replace(/\/+$/, "");
const requestedSnapshot = (argument("snapshot-date") ?? "").trim();
const snapshotDate = requestedSnapshot === "latest" ? await fetchNewestBulkSnapshot(baseUrl, "citations") : requestedSnapshot;
const doImport = flag("import");
const anyCourt = flag("any-court");
const importLimit = Number(argument("import-limit") ?? 50000);
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date=YYYY-MM-DD or --snapshot-date=latest is required");
if (!Number.isInteger(importLimit) || importLimit < 1 || importLimit > 500000) throw new Error("--import-limit must be 1-500000");

const sql = db();
try {
  env();
  const citationsUrl = `${baseUrl}/citations-${snapshotDate}.csv.bz2`;
  const startedAt = Date.now();
  const resolution = await resolveMissingCitationsFromBulk(sql, {
    snapshotDate,
    sourceUri: citationsUrl,
    openCitations: () => openBulkCsvFromUrl(citationsUrl),
  });
  console.log(JSON.stringify({ lane: "cited-case-resolution", snapshotDate, seconds: Math.round((Date.now() - startedAt) / 1000), ...resolution }));

  if (doImport) {
    const clusterIds = new Set(await resolvedClusterIds(sql, importLimit));
    if (!clusterIds.size) {
      console.log(JSON.stringify({ lane: "cited-case-import", snapshotDate, skipped: "no resolved clusters" }));
    } else {
      const federal = anyCourt ? null : await readFederalCourtCodes(
        openBulkCsvFromUrl(`${baseUrl}/courts-${snapshotDate}.csv.bz2`), { includeBankruptcy: false });
      if (federal && federal.size === 0) throw new Error(`No federal court codes found in courts-${snapshotDate}.csv.bz2`);
      const courtFilter = (code: string) => code !== "scotus" && (federal === null || federal.has(code));
      const artifactStore = createArtifactStore({ localRoot: process.env.RAW_ARTIFACT_DIR ?? ".data/raw" });
      const imported = await ingestCourtListenerBulkOpinions(sql, artifactStore, {
        snapshotDate,
        baseUrl,
        lane: "cited-cases",
        courtCodes: federal ?? new Set<string>(),
        clusterIds,
        courtFilter,
        minYear: 1700,
        onProgress: ({ opinionsWritten, opinionsSkipped }) => console.log(JSON.stringify({
          lane: "cited-case-import", progress: true, opinionsWritten, opinionsSkipped,
        })),
      });
      const ingested = await markIngestedResolvedCitations(sql);
      console.log(JSON.stringify({ lane: "cited-case-import", snapshotDate, requested: clusterIds.size, anyCourt, ...imported, citationsIngested: ingested }));
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
