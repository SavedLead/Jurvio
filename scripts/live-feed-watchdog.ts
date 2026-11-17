import { statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db/client";
import { readLiveFeedHealth } from "@/modules/ingestion/application/live-feed-health";

const root = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? "/var/lib/jurvio/artifacts";
const directory = join(root, "scheduler");
const stalePath = join(directory, "live.stale");
const restartPath = join(directory, "live.restarted");

function ageMinutes(path: string): number | null {
  try {
    return (Date.now() - statSync(path).mtimeMs) / 60_000;
  } catch {
    return null;
  }
}

const health = await readLiveFeedHealth(db());
console.log(JSON.stringify({ liveFeedHealth: health }));
if (health.ok) {
  try { unlinkSync(stalePath); } catch { /* already clear */ }
  process.exit(0);
}

const sinceRestart = ageMinutes(restartPath);
console.error(`LIVE_FEED_STALE district_age_min=${health.district.ageMinutes ?? "none"} appeals_age_min=${health.appeals.ageMinutes ?? "none"}`);
if (sinceRestart !== null && sinceRestart < 30) {
  console.error("LIVE_FEED_STALE restart suppressed; the lane restarted within 30 minutes");
  process.exit(0);
}
writeFileSync(stalePath, health.generatedAt);
writeFileSync(restartPath, health.generatedAt);
process.exit(2);
