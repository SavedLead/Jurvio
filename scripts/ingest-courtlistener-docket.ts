import { db, closeDb } from "@/db/client";
import { ingestCourtListenerDocket } from "@/modules/ingestion/application/ingest-courtlistener-docket";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";

const docketId = Number(process.argv[2]);
if (!Number.isInteger(docketId) || docketId <= 0) {
  throw new Error("Usage: pnpm ingest:docket <positive CourtListener docket ID>");
}

try {
  const result = await ingestCourtListenerDocket(
    db(),
    createArtifactStore({ localRoot: process.env.RAW_ARTIFACT_DIR ?? ".data/raw" }),
    docketId,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await closeDb();
}
