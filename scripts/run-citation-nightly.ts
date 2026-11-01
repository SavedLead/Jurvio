import postgres from "postgres";
import { env } from "@/lib/config/env";
import { citationBacklog } from "@/modules/citations/application/citation-lane";
import { refreshCitationStubs } from "@/modules/citations/application/citation-stubs";
import { discoverLiveOpinionText } from "@/modules/ingestion/live-feeds/live-opinion-text";

// Nightly citation catch-up (ADR 0090, plan D13). Scheduled hourly; does its
// work once per America/New_York day inside the off-peak window (01:00-05:00)
// and exits immediately otherwise. All steps are cheap, bounded SQL:
//  1. re-scan the last 7 days of live feeds for opinions whose text was missed;
//  2. give transiently failed live-text rows (not 404/410) one more chance;
//  3. re-queue citation parsing for live-text documents extracted in the last
//     2 days that have no parse rows (lost trigger / crashed worker);
//  4. refresh cited-case stubs (C9), resumable, up to 8 minutes;
//  5. log queue sizes for the coverage history.
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key!, raw];
}));
const force = args.has("force");
const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const sql = postgres(env().DATABASE_URL, { max: 1, connection: { application_name: "jurvio-citation-nightly", statement_timeout: 120_000 } });
try {
  const [state] = await sql<{ at: Date }[]>`SELECT discovered_through AS at FROM live_opinion_text_watermark WHERE source = 'nightly'`;
  const doneToday = state && new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(state.at) === day;
  if (!force && (hour < 1 || hour >= 5 || doneToday)) {
    console.log(JSON.stringify({ citationNightly: "skipped", hour, doneToday: Boolean(doneToday) }));
  } else {
    const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-citation-nightly-v1')) AS ok`;
    if (!lock?.ok) { console.log(JSON.stringify({ citationNightly: "skipped", reason: "lock held" })); process.exit(0); }
    const rescanned = await discoverLiveOpinionText(sql, { rescanDays: 7, limit: 50_000 });
    const retried = await sql`UPDATE live_opinion_text SET state = 'pending', attempts = 0, next_attempt_at = now()
      WHERE state = 'failed' AND coalesce(last_error, '') !~ 'HTTP (404|410)' AND discovered_at > now() - interval '30 days'
      RETURNING 1`;
    const requeued = await sql`INSERT INTO document_citation_work (document_id, priority)
      SELECT q.document_id, 10 FROM live_opinion_text q
      WHERE q.state = 'extracted' AND q.extracted_at > now() - interval '2 days' AND q.document_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM document_case_citation x WHERE x.document_id = q.document_id)
        AND NOT EXISTS (SELECT 1 FROM document_citation_work w WHERE w.document_id = q.document_id)
      LIMIT 20000
      ON CONFLICT (document_id) DO NOTHING RETURNING 1`;
    const stubs = await refreshCitationStubs(sql, { deadline: Date.now() + 8 * 60_000 });
    const backlog = await citationBacklog(sql);
    await sql`INSERT INTO live_opinion_text_watermark (source, discovered_through) VALUES ('nightly', now())
      ON CONFLICT (source) DO UPDATE SET discovered_through = now(), updated_at = now()`;
    console.log(JSON.stringify({ citationNightly: "done", day, rescanned, retriedLiveText: retried.length,
      requeuedUnparsed: requeued.length, stubs, backlog }));
  }
} finally {
  await sql.end();
}
