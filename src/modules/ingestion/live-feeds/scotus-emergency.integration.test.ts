import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchEntityAlerts } from "@/modules/accounts/application/entity-alerts";
import { followEntity, resolveEntityTarget } from "@/modules/accounts/application/entity-follows";
import { alertEligibleSql, followCase, followState } from "@/modules/accounts/application/follows";
import { getEmergencyApplication, listEmergencyApplications } from "@/modules/scotus/application/emergency-docket";
import { coverageSql } from "@/modules/scotus/application/emergency-history";
import { loadEmergencyStats, refreshEmergencyStats, resetEmergencyStatsCache } from "@/modules/scotus/application/emergency-stats";
import { summarize } from "@/modules/scotus/domain/emergency-stats";
import { LocalArtifactStore } from "../infrastructure/local-artifact-store";
import { providerId } from "./persist";
import { runScotusEmergency } from "./scotus-emergency";
import { EMERGENCY_PARSER_VERSION } from "@/modules/scotus/domain/emergency-application";

const databaseUrl = process.env.DATABASE_URL;

async function loadFresh() {
  resetEmergencyStatsCache();
  const stats = await loadEmergencyStats(postgresForFresh!);
  return stats!;
}
let postgresForFresh: ReturnType<typeof postgres> | null = null;
const fixture = (name: string) => readFileSync(join(__dirname, "..", "..", "scotus", "fixtures", "emergency", `${name}.html`), "utf8");
const PAGES: Record<string, string> = { "26A623": fixture("26a623"), "26A624": fixture("26a624"), "26A600": fixture("26a600") };
const NEW_LINE = `<div class="card"><table class="ProceedingItem"><tr><td class="ProceedingDate">Nov 04 2026</td>
<td>Response to application (26A623) requested by Justice Thomas, due by 5 p.m. (EST) on November 6, 2026. <br /></td></tr></table></div>`;

function withExtraLine(html: string): string {
  const last = html.lastIndexOf('<table class="ProceedingItem">');
  const end = html.indexOf("</div>", last) + "</div>".length;
  return `${html.slice(0, end)}\n${NEW_LINE}\n${html.slice(end)}`;
}

describe.skipIf(!databaseUrl)("Supreme Court emergency docket lane against Postgres", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  postgresForFresh = sql;
  const store = new LocalArtifactStore(mkdtempSync(join(tmpdir(), "jurvio-emergency-")));
  const calls: Array<{ url: string; ims: string | null }> = [];
  let pages = { ...PAGES };
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const ims = new Headers(init?.headers).get("if-modified-since");
    calls.push({ url, ims });
    const docket = /public\/(\d{2}a\d+)\.html$/i.exec(url)?.[1]?.toUpperCase() ?? "";
    const body = pages[docket];
    if (!body) return new Response("not found", { status: 404 });
    if (ims && body === PAGES[docket]) return new Response(null, { status: 304 });
    return new Response(body, { status: 200, headers: { "content-type": "text/html", "last-modified": "Wed, 04 Nov 2026 14:00:00 GMT" } });
  }) as unknown as typeof fetch;
  const t0 = new Date("2026-11-04T15:00:00Z");
  const run = (now: Date) => runScotusEmergency(sql, store, { fetchImpl, now: () => now, minIntervalMs: 0, frontierProbes: 5, seedPerRun: 5, seedYears: [26], gapPerRun: 0 });

  const cleanup = async () => {
    await sql`DELETE FROM scotus_application_event WHERE docket_number LIKE '26A%'`;
    await sql`DELETE FROM scotus_application WHERE docket_number LIKE '26A%'`;
    await sql`DELETE FROM scotus_source_poll WHERE docket_number LIKE '26A%' OR docket_number IS NULL`;
    await sql`DELETE FROM legal_case WHERE docket_number ~ '^26A[0-9]+$'
      AND court_id IN (SELECT id FROM court WHERE lower(provider_court_id) = 'scotus')`;
  };

  beforeAll(async () => {
    await cleanup();
    const provider = await providerId(sql, "scotus_official");
    let [court] = await sql<{ id: string }[]>`SELECT id FROM court WHERE lower(provider_court_id) = 'scotus' LIMIT 1`;
    if (!court) {
      [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_id, provider_court_id, name)
        VALUES ('jc-scotusemerg', ${provider}, 'scotus', 'Supreme Court of the United States') RETURNING id`;
    }
    // Held by the JSON discovery lane but never read by this lane.
    await sql`INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-emerg622', ${court!.id}, '26A622', 'Applicant v. Respondent', 'draft'),
             ('jv-emerg600', ${court!.id}, '26A600', 'William Michael Spearman v. United States', 'draft')`;
  });
  const users: string[] = [];
  afterAll(async () => {
    await sql`DELETE FROM app_user WHERE id = ANY(${users})`;
    await cleanup();
    await sql.end();
  });

  it("discovers new applications past the frontier, seeds held ones, and stores public lines", async () => {
    const result = await run(t0);
    expect(result.errors).toEqual([]);
    expect(result.discovered).toEqual(expect.arrayContaining(["26A623", "26A624"]));
    expect(calls.filter((call) => /26a62[5-7]\.html$/i.test(call.url))).toHaveLength(3); // three misses, then stop
    expect(calls.some((call) => /26a628\.html$/i.test(call.url))).toBe(false);
    expect(calls.every((call) => !call.url.includes("/rss/"))).toBe(true);
    const rows = await sql<Array<{ docket_number: string; kind: string; applicant_kind: string; status: string; submitted_justice: string | null;
      expected_justice: string | null; poll_tier: string; capital: boolean; case_id: string | null }>>`
      SELECT docket_number, kind, applicant_kind, status, submitted_justice, expected_justice, poll_tier, capital, case_id
      FROM scotus_application WHERE docket_number LIKE '26A%' ORDER BY docket_number`;
    expect(rows.map((row) => row.docket_number)).toEqual(["26A600", "26A623", "26A624"]);
    expect(rows.find((row) => row.docket_number === "26A624")).toMatchObject({
      kind: "injunction", applicant_kind: "federal", status: "denied", submitted_justice: "Kagan", expected_justice: "Kagan", poll_tier: "closed" });
    expect(rows.find((row) => row.docket_number === "26A623")).toMatchObject({ kind: "stay_of_execution", capital: true, status: "pending", poll_tier: "open" });
    expect(rows.find((row) => row.docket_number === "26A600")).toMatchObject({ kind: "extension", poll_tier: "closed" });

    // Every stored line has a docket entry with a displayable decision, so alerts can use it.
    const entries = await sql<{ n: number; decided: number }[]>`
      SELECT count(*)::int AS n, count(pd.id)::int AS decided FROM docket_entry e
      JOIN scotus_application a ON a.case_id = e.case_id AND a.docket_number = '26A624'
      LEFT JOIN publication_decision pd ON pd.object_type = 'docket_entry' AND pd.object_id = e.id AND pd.displayable`;
    expect(entries[0]).toEqual({ n: 3, decided: 3 });

    // Serious applications can be followed while their case is a draft; extensions cannot.
    const eligible = await sql<{ docket_number: string; ok: boolean }[]>`
      SELECT a.docket_number, ${sql.unsafe(alertEligibleSql("c"))} AS ok
      FROM scotus_application a JOIN legal_case c ON c.id = a.case_id WHERE a.docket_number LIKE '26A%' ORDER BY a.docket_number`;
    expect(Object.fromEntries(eligible.map((row) => [row.docket_number, row.ok]))).toEqual({ "26A600": false, "26A623": true, "26A624": true });
  });

  it("re-checks open applications with If-Modified-Since and records new lines", async () => {
    calls.length = 0;
    const second = await run(new Date(t0.getTime() + 10 * 60_000));
    expect(second.notModified).toBe(1);
    expect(calls.find((call) => /26a623\.html$/i.test(call.url))?.ims).toBeTruthy();
    expect(calls.some((call) => /26a624\.html$/i.test(call.url))).toBe(false); // decided: daily

    pages = { ...PAGES, "26A623": withExtraLine(PAGES["26A623"]!) };
    const third = await run(new Date(t0.getTime() + 20 * 60_000));
    expect(third.newEvents).toBe(1);
    const [app] = await sql<{ response_due_on: string; poll_tier: string }[]>`
      SELECT response_due_on::text, poll_tier FROM scotus_application WHERE docket_number = '26A623'`;
    expect(app).toEqual({ response_due_on: "2026-11-06", poll_tier: "open" });
    const [event] = await sql<{ kind: string; backfilled: boolean }[]>`
      SELECT kind, backfilled FROM scotus_application_event WHERE docket_number = '26A623' ORDER BY position DESC LIMIT 1`;
    expect(event).toEqual({ kind: "response_requested", backfilled: false });
  });

  it("re-reads pages stored by an older parser in full and refreshes their lines without new alerts", async () => {
    await sql`UPDATE scotus_application SET parser_version = 'scotus-emergency-v0', status = 'pending', ruling_on = NULL WHERE docket_number = '26A624'`;
    await sql`UPDATE scotus_application_event SET kind = 'other' WHERE docket_number = '26A624' AND kind = 'denied'`;
    const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM scotus_application_event WHERE docket_number = '26A624'`;
    calls.length = 0;
    pages = { ...PAGES };
    const fourth = await run(new Date(t0.getTime() + 30 * 60_000));
    const call = calls.find((item) => /26a624\.html$/i.test(item.url));
    expect(call).toBeTruthy();
    expect(call?.ims).toBeFalsy();
    expect(fourth.newEvents).toBe(0);
    const [app] = await sql<{ status: string; parser_version: string }[]>`
      SELECT status, parser_version FROM scotus_application WHERE docket_number = '26A624'`;
    expect(app).toEqual({ status: "denied", parser_version: EMERGENCY_PARSER_VERSION });
    const [after] = await sql<{ n: number; denied: number }[]>`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE kind = 'denied')::int AS denied FROM scotus_application_event WHERE docket_number = '26A624'`;
    expect(after).toEqual({ n: before!.n, denied: 1 });
  });

  it("serves the list (extensions hidden by default) and the detail page data", async () => {
    const list = await listEmergencyApplications(sql, { status: "all", extensions: false, applicant: null, kind: null });
    expect(list?.rows.map((row) => row.docketNumber).filter((docket) => docket.startsWith("26A"))).toEqual(["26A623", "26A624"]);
    const withExtensions = await listEmergencyApplications(sql, { status: "all", extensions: true, applicant: null, kind: null });
    expect(withExtensions?.rows.map((row) => row.docketNumber)).toContain("26A600");
    const detail = await getEmergencyApplication(sql, "26A623");
    expect(detail).toMatchObject({ responseDueOn: "2026-11-06", responseRequestedBy: "Thomas", capital: true, linkedDocket: "26-6013" });
    expect(detail?.jurvioCase?.followable).toBe(true);
    expect(await getEmergencyApplication(sql, "26A999")).toBeNull();
    expect(await getEmergencyApplication(sql, "'; select 1")).toBeNull();
  });

  it("lets a Free user follow a serious application and an emergency feed, which matches new lines", async () => {
    const [user] = await sql<{ id: string }[]>`INSERT INTO app_user (email, email_verified_at) VALUES (${`emerg-${Date.now()}@example.test`}, now()) RETURNING id`;
    users.push(user!.id);
    expect((await followCase(sql, user!.id, "jv-emerg600")).status).toBe("not_eligible"); // extension
    const [app] = await sql<{ public_id: string }[]>`
      SELECT c.public_id FROM scotus_application a JOIN legal_case c ON c.id = a.case_id WHERE a.docket_number = '26A623'`;
    expect((await followCase(sql, user!.id, app!.public_id)).status).toBe("followed");
    expect((await followState(sql, user!.id, app!.public_id)).followLimit).toBe(5);

    const target = await resolveEntityTarget(sql, "emergency", "capital");
    expect(target).toMatchObject({ kind: "emergency", targetKey: "capital" });
    expect(await resolveEntityTarget(sql, "emergency", "not-a-feed")).toBeNull();
    const followed = await followEntity(sql, user!.id, target!, "daily");
    expect(followed.status).toBe("followed");
    await sql`UPDATE entity_follow SET created_at = now() - interval '2 hours' WHERE user_id = ${user!.id}`;
    const followIds = (await sql<{ id: string }[]>`SELECT id FROM entity_follow WHERE user_id = ${user!.id}`).map((row) => row.id);
    const run = await matchEntityAlerts(sql, { window: { from: new Date(Date.now() - 60 * 60_000), to: new Date(Date.now() + 60_000) }, followIds });
    expect(run.byKind.emergency).toBeGreaterThan(0);
    const items = await sql<{ summary: string; docket: string }[]>`
      SELECT i.summary, c.docket_number AS docket FROM entity_alert_item i JOIN legal_case c ON c.id = i.case_id WHERE i.follow_id = ANY(${followIds})`;
    // Capital feed: only the stay of execution, never the federal injunction or the extension.
    expect(new Set(items.map((item) => item.docket))).toEqual(new Set(["26A623"]));
    expect(items.some((item) => item.summary.startsWith("Response requested: "))).toBe(true);
  });

  it("rebuilds the precomputed analytics counts from the applications (migration 0196)", async () => {
    const result = await refreshEmergencyStats(sql, { force: true });
    expect(result.refreshed).toBe(true);
    const [held] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM scotus_application`;
    const stats = await loadEmergencyStats(sql);
    expect(stats).not.toBeNull();
    expect(stats!.stats.reduce((sum, row) => sum + row.applications, 0)).toBe(held!.n);
    expect(stats!.meta.applications).toBe(held!.n);
    const dashboard = summarize(stats!.stats, stats!.votes, { term: null, applicant: null, circuit: null, extensions: true });
    expect(dashboard.totals.applications).toBe(held!.n);
    // Unchanged applications: a second, unforced refresh right away is skipped.
    expect((await refreshEmergencyStats(sql)).refreshed).toBe(false);
    const [lane] = await sql<{ lanes: string[] }[]>`SELECT array_agg(DISTINCT source_lane) AS lanes FROM scotus_application WHERE docket_number LIKE '26A%'`;
    expect(lane!.lanes).toEqual(["live"]);
  });

  it("flags a docket year complete only after the history scan finished it (migration 0197)", async () => {
    await sql`DELETE FROM scotus_emergency_history_coverage`;
    await refreshEmergencyStats(sql, { force: true });
    expect((await loadFresh()).meta.terms.find((row) => row.term === 2026)?.complete).toBe(false);
    await sql.unsafe(coverageSql([{ term: 2026, complete: true, highest: 700, pages: 690 }]));
    // A later partial scan never clears it.
    await sql.unsafe(coverageSql([{ term: 2026, complete: false, highest: 20, pages: 20 }]));
    await refreshEmergencyStats(sql, { force: true });
    const meta = (await loadFresh()).meta;
    expect(meta.terms.find((row) => row.term === 2026)?.complete).toBe(true);
    expect(meta.historyFrom).toBe(2017);
    const [row] = await sql<{ highest: number }[]>`SELECT highest_number AS highest FROM scotus_emergency_history_coverage WHERE term = 2026`;
    expect(row!.highest).toBe(700);
    await sql`DELETE FROM scotus_emergency_history_coverage`;
  });

  it("keeps history rows out of the public list and its header counts", async () => {
    const filters = { extensions: true, applicant: null, kind: null } as const;
    const before = await listEmergencyApplications(sql, { status: "all", ...filters });
    await sql`
      INSERT INTO scotus_application (docket_number, caption, kind, applicant_kind, status, source_url, parser_version, source_lane, submitted_on, ruling_on, last_entry_on, poll_tier)
      VALUES ('17A9991', 'Hist v. Extension', 'extension', 'private', 'granted', 'https://www.supremecourt.gov/docket/docketfiles/html/public/17a9991.html',
          ${EMERGENCY_PARSER_VERSION}, 'history', '2017-08-01', ${new Date().toISOString().slice(0, 10)}, '2017-08-02', 'retired'),
        ('17A9992', 'Hist v. Stay', 'stay', 'federal', 'denied', 'https://www.supremecourt.gov/docket/docketfiles/html/public/17a9992.html',
          ${EMERGENCY_PARSER_VERSION}, 'history', '2017-08-01', ${new Date().toISOString().slice(0, 10)}, '2017-08-02', 'retired')`;
    try {
      for (const status of ["all", "decided", "open"] as const) {
        const list = await listEmergencyApplications(sql, { status, ...filters });
        expect(list!.rows.some((row) => row.docketNumber.startsWith("17A999"))).toBe(false);
      }
      const after = await listEmergencyApplications(sql, { status: "all", ...filters });
      expect(after!.counts).toEqual(before!.counts);
    } finally {
      await sql`DELETE FROM scotus_application WHERE docket_number IN ('17A9991', '17A9992')`;
    }
  });

  it("never lists an old history application with no ruling as open", async () => {
    const before = await listEmergencyApplications(sql, { status: "open", extensions: false, applicant: null, kind: null });
    await sql`
      INSERT INTO scotus_application (docket_number, caption, kind, applicant_kind, status, source_url, parser_version, source_lane, submitted_on, last_entry_on, poll_tier)
      VALUES ('26A9998', 'Old v. History', 'stay', 'private', 'pending', 'https://www.supremecourt.gov/docket/docketfiles/html/public/26a9998.html',
        ${EMERGENCY_PARSER_VERSION}, 'history', '2017-07-31', '2017-08-21', 'retired')`;
    const after = await listEmergencyApplications(sql, { status: "open", extensions: false, applicant: null, kind: null });
    expect(after!.rows.some((row) => row.docketNumber === "26A9998")).toBe(false);
    expect(after!.counts.openSerious).toBe(before!.counts.openSerious);
    await sql`DELETE FROM scotus_application WHERE docket_number = '26A9998'`;
  });

  it("never polls or re-parses an earlier year's history row, so it stays out of the live lane", async () => {
    await sql`
      INSERT INTO scotus_application (docket_number, caption, kind, applicant_kind, status, source_url, parser_version, source_lane, submitted_on, last_entry_on, poll_tier)
      VALUES ('25A9997', 'Hist v. Polled', 'stay', 'private', 'denied', 'https://www.supremecourt.gov/docket/docketfiles/html/public/25a9997.html',
        'old-parser', 'history', '2025-07-31', '2025-08-21', 'closed')`;
    await sql`
      INSERT INTO scotus_source_poll (url, docket_number, last_status, checked_at, next_check_at, updated_at)
      VALUES ('https://www.supremecourt.gov/docket/docketfiles/html/public/25a9997.html', '25A9997', 200, now(), now() - interval '1 day', now())`;
    try {
      const seen = calls.length;
      await run(new Date(t0.getTime() + 30 * 86_400_000));
      expect(calls.slice(seen).some((call) => /25a9997/i.test(call.url))).toBe(false);
      const [row] = await sql<{ source_lane: string }[]>`SELECT source_lane FROM scotus_application WHERE docket_number = '25A9997'`;
      expect(row!.source_lane).toBe("history");
    } finally {
      await sql`DELETE FROM scotus_source_poll WHERE docket_number = '25A9997'`;
      await sql`DELETE FROM scotus_application WHERE docket_number = '25A9997'`;
    }
  });

  it("adopts this docket year's history rows as live applications, without new lines", async () => {
    await sql`UPDATE scotus_application SET source_lane = 'history' WHERE docket_number = '26A600'`;
    const events = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM scotus_application_event WHERE docket_number = '26A600' AND NOT backfilled`;
    const result = await run(new Date(t0.getTime() + 31 * 86_400_000));
    expect(result.adopted).toBe(1);
    const [row] = await sql<{ source_lane: string }[]>`SELECT source_lane FROM scotus_application WHERE docket_number = '26A600'`;
    expect(row!.source_lane).toBe("live");
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM scotus_application_event WHERE docket_number = '26A600' AND NOT backfilled`;
    expect(after[0]!.n).toBe(events[0]!.n);
  });

  it("reads numbers below the frontier it never had, newest first, and waits a week on a missing one", async () => {
    const at = new Date(t0.getTime() + 32 * 86_400_000);
    const gapRun = () => runScotusEmergency(sql, store, { fetchImpl, now: () => at, minIntervalMs: 0, frontierProbes: 0, seedPerRun: 0, reparsePerRun: 0, seedYears: [26], gapPerRun: 3 });
    const known = new Set((await sql<{ docket_number: string }[]>`SELECT docket_number FROM scotus_application WHERE docket_number LIKE '26A%'`).map((row) => row.docket_number));
    const docket = (url: string) => /public\/(\d{2}a\d+)\.html$/i.exec(url)?.[1]?.toUpperCase() ?? "";
    const number = (value: string) => Number(value.slice(3));
    const seen = calls.length;
    const result = await gapRun();
    // Due re-checks of known applications run too; the gap reads are the unknown numbers.
    const probed = calls.slice(seen).map((call) => docket(call.url)).filter((value) => !known.has(value));
    expect(result.gapsRead).toBe(3);
    expect(probed).toHaveLength(3);
    expect(probed.every((value) => value.startsWith("26A"))).toBe(true);
    expect([...probed].sort((a, b) => number(b) - number(a))).toEqual(probed);
    const missing = probed.filter((value) => !(value in PAGES));
    const polls = await sql<{ next_check_at: Date }[]>`SELECT next_check_at FROM scotus_source_poll WHERE docket_number = ANY(${missing})`;
    expect(polls).toHaveLength(missing.length);
    for (const poll of polls) expect(new Date(poll.next_check_at).getTime()).toBeGreaterThan(at.getTime() + 6 * 86_400_000);
    const again = calls.length;
    await gapRun();
    const second = calls.slice(again).map((call) => docket(call.url)).filter((value) => !known.has(value));
    expect(second).toHaveLength(3);
    expect(second.some((value) => probed.includes(value))).toBe(false);
    expect(Math.max(...second.map(number))).toBeLessThan(Math.min(...probed.map(number)));
  });
});
