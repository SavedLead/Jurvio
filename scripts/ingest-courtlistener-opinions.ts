import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { ingestCourtListenerOpinionCluster } from "@/modules/ingestion/application/ingest-courtlistener-opinion-cluster";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { fetchOpinionClusterIds } from "@/modules/ingestion/providers/courtlistener/client";
import {
  finishIngestionRun,
  finishIngestionRunItem,
  startIngestionRun,
  startIngestionRunItem,
} from "@/modules/ingestion/application/ingestion-run";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const courtCode = option("court", "scotus").trim().toLowerCase();
const filedAfter = option("since", "2022-01-01");
const limit = Number(option("limit", "25"));
const delayMs = Number(option("delay-ms", "1000"));
const order = option("order", "newest");

if (!/^[a-z0-9-]{2,32}$/.test(courtCode)) throw new Error("--court is invalid");
if (!/^\d{4}-\d{2}-\d{2}$/.test(filedAfter)) throw new Error("--since must be YYYY-MM-DD");
if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("--limit must be 1-500");
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms must be 0-60000");
}
if (order !== "newest" && order !== "cited") {
  throw new Error("--order must be newest or cited");
}

const artifactRoot = process.env.RAW_ARTIFACT_DIR ?? ".data/raw";
const artifactStore = createArtifactStore({ localRoot: artifactRoot });

try {
  env();
  const clusterIds = await fetchOpinionClusterIds({ courtCode, filedAfter, limit, order });
  const runId = await startIngestionRun(db(), {
    providerCode: "courtlistener",
    runType: "targeted_opinion_clusters",
    selection: { courtCode, filedAfter, requestedLimit: limit, delayMs, order },
    selectedCount: clusterIds.length,
  });
  process.stdout.write(`Selected ${clusterIds.length} ${courtCode} opinion clusters filed since ${filedAfter}.\n`);

  try {
    let failureCount = 0;
    for (const [index, clusterId] of clusterIds.entries()) {
      await startIngestionRunItem(db(), runId, String(clusterId));
      try {
        const result = await ingestCourtListenerOpinionCluster(db(), artifactStore, clusterId);
        await finishIngestionRunItem(db(), {
          runId, sourceRecordId: String(clusterId), casePublicId: result.caseId,
          documentCount: result.documents.length,
        });
        process.stdout.write(`${index + 1}/${clusterIds.length} cluster ${clusterId}: ${result.documents.length} readable opinion(s), ${result.skippedOpinions.length} skipped.\n`);
      } catch (error) {
        failureCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        await finishIngestionRunItem(db(), { runId, sourceRecordId: String(clusterId), error: message });
        process.stderr.write(`${index + 1}/${clusterIds.length} cluster ${clusterId} failed: ${message}\n`);
      }
      if (delayMs && index < clusterIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    await finishIngestionRun(db(), runId);
    if (failureCount > 0) process.exitCode = 1;
  } catch (error) {
    await finishIngestionRun(db(), runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
} finally {
  await closeDb();
}
