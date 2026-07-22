import postgres from "postgres";
import { env } from "../src/lib/config/env";
import { LocalArtifactStore } from "../src/modules/ingestion/infrastructure/local-artifact-store";
import { ingestCourtListenerOpinionCluster } from "../src/modules/ingestion/application/ingest-courtlistener-opinion-cluster";

const clusterId = Number(process.argv[2]);
if (!Number.isInteger(clusterId) || clusterId <= 0) {
  throw new Error("Usage: pnpm ingest:opinion-cluster <courtlistener-cluster-id>");
}

const sql = postgres(env().DATABASE_URL, { max: 2 });
try {
  const result = await ingestCourtListenerOpinionCluster(
    sql,
    new LocalArtifactStore(process.env.RAW_ARTIFACT_DIR ?? ".data/raw"),
    clusterId,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end();
}
