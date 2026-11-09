/**
 * Hourly continuous publisher. Exits before opening the database unless
 * CONTINUOUS_PUBLISH=1 and JURVIO_PAUSE_CONTINUOUS_PUBLISH is not 1.
 *
 *   node jobs/run-continuous-publish.mjs --limit=100
 */
import { continuousPublishEnabled } from "@/modules/publication/domain/continuous-publish";

const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? "100");
if (!continuousPublishEnabled()) {
  console.log(JSON.stringify({ skipped: "off", published: 0, entriesShown: 0, alertsQueued: 0 }));
  process.exit(0);
}

const { closeDb, db } = await import("@/db/client");
const { runContinuousPublish } = await import("@/modules/publication/application/continuous-publish");
try {
  console.log(JSON.stringify(await runContinuousPublish(db(), { limit })));
} finally {
  await closeDb();
}
