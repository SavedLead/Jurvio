import postgres from "postgres";
import { env } from "@/lib/config/env";
import { runAgencySources } from "@/modules/agency-sources/application/run";
import { adaptersFor } from "@/modules/agency-sources/sources";

// Official agency and settlement sources of federal case filings (DOJ, SEC, FTC,
// state attorneys general, settlement administrators). Items that state a court and
// docket number matching exactly one Jurvio case are linked to it; everything else
// waits in the internal review queue. See docs/operations/agency-sources.md.
//   node jobs/run-agency-sources.mjs --source=all|doj|sec|ftc|state-ag|settlements
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const group = args.get("source") ?? "all";
const adapters = adaptersFor(group);

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: `jurvio-agency-sources-${group}`, statement_timeout: 60_000 },
});
const lockKey = `jurvio-agency-sources-${group}-v1`;
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ agencySources: "skipped", group, reason: "previous run still active" }));
  } else {
    const started = Date.now();
    const { reports, recheck } = await runAgencySources(sql, adapters);
    const polled = reports.filter((report) => report.status !== "skipped");
    const totals = reports.reduce((sum, row) => ({
      requests: sum.requests + row.requests, itemsSeen: sum.itemsSeen + row.itemsSeen, itemsNew: sum.itemsNew + row.itemsNew,
      refs: sum.refs + row.refs, matched: sum.matched + row.matched, queued: sum.queued + row.queued,
      failed: sum.failed + (["failed", "blocked", "rate_limited"].includes(row.status) ? 1 : 0),
    }), { requests: 0, itemsSeen: 0, itemsNew: 0, refs: 0, matched: 0, queued: 0, failed: 0 });
    console.log(JSON.stringify({ agencySources: group, elapsedMs: Date.now() - started, totals, recheck, reports }));
    // One blocked source is normal; only a total failure fails the job.
    if (polled.length > 0 && totals.failed === polled.length) process.exitCode = 1;
  }
} finally {
  await sql.end();
}
