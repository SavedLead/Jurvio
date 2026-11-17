import postgres from "postgres";
import { env } from "@/lib/config/env";
import { backfillFilingWindow, type FilingFamily } from "@/modules/ingestion/application/backfill-filing-window";

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
    log: (event) => console.log(JSON.stringify({ filingBackfill: event })),
  });
  console.log(JSON.stringify({ filingBackfill: "done", ...checkpoint }));
  if (checkpoint.stopped && checkpoint.stopped !== "complete") process.exitCode = checkpoint.stopped === "quiet-window" ? 0 : 1;
} finally {
  await sql.end();
}
