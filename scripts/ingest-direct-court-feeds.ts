import { closeDb, db } from "@/db/client";
import { ingestDirectCourtFeed } from "@/modules/ingestion/application/ingest-direct-court-feed";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import {
  FEDERAL_COURT_REGISTRY,
  federalCourtByCode,
} from "@/modules/ingestion/providers/courts/registry";

const courtArgument = process.argv.find((value) => value.startsWith("--court="));
const courtCode = courtArgument?.slice("--court=".length) ?? "all";
const courts = courtCode === "all"
  ? FEDERAL_COURT_REGISTRY.filter((court) => court.rssAvailable)
  : [federalCourtByCode(courtCode)].filter((court) => court?.rssAvailable);
if (courts.length === 0) throw new Error(`No enabled direct court feed for ${courtCode}`);

const sql = db();
const store = new LocalArtifactStore(
  process.env.RAW_ARTIFACT_DIR ?? process.env.JURVIO_ARTIFACT_ROOT ?? ".data/raw",
);
try {
  const results = [];
  for (const court of courts) {
    if (court) results.push(await ingestDirectCourtFeed(sql, store, court));
  }
  console.log(JSON.stringify({
    lane: "direct-court-future-and-updates",
    historicalBulkUnchanged: true,
    results,
  }));
} finally {
  await closeDb();
}
