import postgres from "postgres";
import { env } from "@/lib/config/env";
import { backfillRecentFilings, fillStoredFeedFilings, recentFilingBounds } from "@/modules/ingestion/application/backfill-recent-filings";
import { backfillFilingWindow, filingBackfillExitCode, type FilingFamily } from "@/modules/ingestion/application/backfill-filing-window";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const family = args.get("family");
if (family !== "appeals" && family !== "district") throw new Error("--family must be appeals or district");
const windowDays = Number(args.get("window-days"));
if (![30, 60, 90, 365].includes(windowDays)) throw new Error("--window-days must be 30, 60, 90, or 365");
const snapshotDate = args.get("snapshot-date") ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date must be YYYY-MM-DD");
const filePath = args.get("file");
if (!filePath) throw new Error("--file is required");
const allowAnytime = args.get("allow-anytime") === "true";
const fillDrafts = args.get("fill-drafts") === "true";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

const sql = postgres(env().DATABASE_URL, { max: 2, idle_timeout: 20 });
try {
  const checkpoint = await backfillFilingWindow({
    sql,
    filePath,
    snapshotDate,
    family: family as FilingFamily,
    windowDays,
    today,
    allowAnytime,
    fillDrafts,
    log: (event) => console.log(JSON.stringify({ filingBackfill: event })),
  });
  let storedFeeds = null;
  let recent = null;
  const bounds = recentFilingBounds(snapshotDate, today, windowDays);
  if (!fillDrafts && checkpoint.stopped === "complete" && bounds) {
    const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    if (!provider) throw new Error("courtlistener provider is missing");
    const gap = { providerId: provider.id, family: family as FilingFamily, today, windowDays };
    storedFeeds = await fillStoredFeedFilings(sql, { ...gap, bounds });
    recent = await backfillRecentFilings(sql, { ...gap, snapshotDate, baseUrl: env().COURTLISTENER_API_BASE_URL });
  }
  console.log(JSON.stringify({ filingBackfill: "done", snapshot: checkpoint, storedFeeds, recent }));
  const stopped = recent?.stopped === "quota" ? "quota" : checkpoint.stopped;
  process.exitCode = filingBackfillExitCode(stopped);
} finally {
  await sql.end();
}
