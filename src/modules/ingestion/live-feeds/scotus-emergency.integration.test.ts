import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchEntityAlerts } from "@/modules/accounts/application/entity-alerts";
import { followEntity, resolveEntityTarget } from "@/modules/accounts/application/entity-follows";
import { alertEligibleSql, followCase, followState } from "@/modules/accounts/application/follows";
import { getEmergencyApplication, listEmergencyApplications } from "@/modules/scotus/application/emergency-docket";
import { loadEmergencyStats, refreshEmergencyStats } from "@/modules/scotus/application/emergency-stats";
import { summarize } from "@/modules/scotus/domain/emergency-stats";
import { LocalArtifactStore } from "../infrastructure/local-artifact-store";
import { providerId } from "./persist";
import { runScotusEmergency } from "./scotus-emergency";
import { EMERGENCY_PARSER_VERSION } from "@/modules/scotus/domain/emergency-application";

const databaseUrl = process.env.DATABASE_URL;
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
  const run = (now: Date) => runScotusEmergency(sql, store, { fetchImpl, now: () => now, minIntervalMs: 0, frontierProbes: 5, seedPerRun: 5, seedYears: [26] });

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
});
