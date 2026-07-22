import { closeDb, db } from "@/db/client";
import { env } from "@/lib/config/env";
import { ingestCourtListenerOpinionCluster } from "@/modules/ingestion/application/ingest-courtlistener-opinion-cluster";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import { fetchOpinionClusterIds } from "@/modules/ingestion/providers/courtlistener/client";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const courtCode = option("court", "scotus").trim().toLowerCase();
const filedAfter = option("since", "2022-01-01");
const limit = Number(option("limit", "25"));
const delayMs = Number(option("delay-ms", "1000"));

if (!/^[a-z0-9-]{2,32}$/.test(courtCode)) throw new Error("--court is invalid");
if (!/^\d{4}-\d{2}-\d{2}$/.test(filedAfter)) throw new Error("--since must be YYYY-MM-DD");
if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("--limit must be 1-500");
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms must be 0-60000");
}

const artifactRoot = process.env.RAW_ARTIFACT_DIR ?? ".data/raw";
const artifactStore = new LocalArtifactStore(artifactRoot);

try {
  env();
  const clusterIds = await fetchOpinionClusterIds({ courtCode, filedAfter, limit });
  process.stdout.write(`Selected ${clusterIds.length} ${courtCode} opinion clusters filed since ${filedAfter}.\n`);

  for (const [index, clusterId] of clusterIds.entries()) {
    try {
      const result = await ingestCourtListenerOpinionCluster(db(), artifactStore, clusterId);
      process.stdout.write(`${index + 1}/${clusterIds.length} cluster ${clusterId}: ${result.documents.length} readable opinion(s), ${result.skippedOpinions.length} skipped.\n`);
    } catch (error) {
      process.stderr.write(`${index + 1}/${clusterIds.length} cluster ${clusterId} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (delayMs && index < clusterIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
} finally {
  await closeDb();
}
