import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOJ_ADAPTER, dojPageUrl } from "../providers/doj";
import { SEC_ADAPTERS } from "../providers/sec";
import { JND_ADAPTER, SETTLEMENT_SITES_ADAPTER } from "../providers/settlements";
import { runAgencySource, runAgencySources } from "./run";
import { listCaseAgencyItems } from "./public-items";

const databaseUrl = process.env.DATABASE_URL;
const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

function fixtureFetch(routes: Record<string, string | number>, calls: string[] = []) {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const body = routes[url];
    if (typeof body === "number") return new Response("blocked", { status: body });
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

const noSleep = async () => undefined;
const fast = (adapter: typeof DOJ_ADAPTER) => ({ ...adapter, budget: { ...adapter.budget, minIntervalMs: 0 } });

describe.skipIf(!databaseUrl)("agency sources against Postgres", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  const ids: Record<string, string> = {};

  const cleanup = async () => {
    await sql`DELETE FROM agency_item_case_ref WHERE item_id IN (SELECT id FROM agency_source_item WHERE source_code IN ('doj-press-releases', 'sec-litigation-releases', 'sec-administrative-proceedings', 'settlement-admin-jnd', 'settlement-websites'))`;
    await sql`DELETE FROM agency_source_item WHERE source_code IN ('doj-press-releases', 'sec-litigation-releases', 'sec-administrative-proceedings', 'settlement-admin-jnd', 'settlement-websites')`;
    await sql`DELETE FROM agency_source_run WHERE source_code IN ('doj-press-releases', 'sec-litigation-releases', 'sec-administrative-proceedings', 'settlement-admin-jnd', 'settlement-websites')`;
    await sql`DELETE FROM agency_source WHERE code IN ('doj-press-releases', 'sec-litigation-releases', 'sec-administrative-proceedings', 'settlement-admin-jnd', 'settlement-websites')`;
    await sql`DELETE FROM legal_case WHERE public_id LIKE 'jv-agencyt%'`;
  };

  beforeAll(async () => {
    await cleanup();
    const [cl] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const court = async (code: string) => (await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name) VALUES (${`jc-agencyt${code}`}, ${cl!.id}, ${code}, ${code})
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = court.name RETURNING id`)[0]!.id;
    const kase = async (publicId: string, courtCode: string, docket: string, caption: string, publication = "published") => {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
        VALUES (${publicId}, ${await court(courtCode)}, ${docket}, ${caption}, ${publication}::publication_state)
        ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL DO UPDATE SET caption = EXCLUDED.caption, public_id = EXCLUDED.public_id
        RETURNING id`;
      ids[publicId] = row!.id;
    };
    // SDFL stores the office digit the release leaves out; WDLA has the same number in a different court too.
    await kase("jv-agencyt01", "flsd", "9:26-cr-80031", "USA v. Hollingsworth");
    await kase("jv-agencyt02", "lawd", "1:26-cr-00110", "USA v. Taylor");
    await kase("jv-agencyt03", "txsd", "1:26-cr-00110", "USA v. Taylor");
    await kase("jv-agencyt04", "lawd", "1:26-cr-00111", "USA v. Somebody Else");
    await kase("jv-agencyt05", "scd", "6:26-cv-05267", "Securities and Exchange Commission v. Urich", "draft");
    await kase("jv-agencyt06", "njd", "2:18-cv-04772", "In re Celgene Corporation Securities Litigation");
  });

  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  it("DOJ: links only exact court + docket matches whose caption names a party, queues the rest", async () => {
    const routes = {
      "https://www.justice.gov/robots.txt": "User-agent: *\nDisallow: /core/\n",
      [dojPageUrl(0)]: fixture("doj-press-releases.json"),
      [dojPageUrl(1)]: JSON.stringify({ results: [] }),
    };
    const calls: string[] = [];
    const report = await runAgencySource(sql as never, fast(DOJ_ADAPTER), { fetchImpl: fixtureFetch(routes, calls), sleep: noSleep });
    expect(report).toMatchObject({ source: "doj-press-releases", status: "ok", itemsSeen: 5, itemsNew: 5 });
    expect(calls[0]).toBe("https://www.justice.gov/robots.txt");

    const refs = await sql<{ docket_number: string; court_code: string; match_status: string; public_id: string | null }[]>`
      SELECT ref.docket_number, ref.court_code, ref.match_status, legal_case.public_id
      FROM agency_item_case_ref ref LEFT JOIN legal_case ON legal_case.id = ref.case_id
      JOIN agency_source_item item ON item.id = ref.item_id WHERE item.source_code = 'doj-press-releases'
      ORDER BY ref.docket_number, ref.court_code`;
    const status = Object.fromEntries(refs.map((ref) => [`${ref.court_code}:${ref.docket_number}`, [ref.match_status, ref.public_id]]));
    expect(status["flsd:26-cr-80031"]).toEqual(["matched", "jv-agencyt01"]);
    expect(status["lawd:1:26-cr-00110"]).toEqual(["matched", "jv-agencyt02"]);
    // Same court and number, but the caption names nobody in the release: review, not a link.
    expect(status["lawd:1:26-cr-00111"]?.[0]).toBe("ambiguous");
    expect(status["lawd:1:26-cr-00100"]?.[0]).toBe("unmatched");

    const statuses = await sql<{ review_status: string; n: number }[]>`
      SELECT review_status, count(*)::int AS n FROM agency_source_item WHERE source_code = 'doj-press-releases' GROUP BY 1 ORDER BY 1`;
    expect(statuses).toEqual([{ review_status: "linked", n: 2 }, { review_status: "queued", n: 3 }]);

    const shown = await listCaseAgencyItems(sql as never, "jv-agencyt01");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ publisher: "U.S. Department of Justice", issuingOffice: "USAO - Florida, Southern", docketNumber: "26-cr-80031" });
    expect(shown[0]!.sourceUrl).toMatch(/^https:\/\/www\.justice\.gov\/usao-sdfl\//);
    expect(await listCaseAgencyItems(sql as never, "jv-agencyt03")).toEqual([]);

    const [cursor] = await sql<{ cursor_value: string }[]>`SELECT cursor_value FROM agency_source WHERE code = 'doj-press-releases'`;
    expect(cursor!.cursor_value).toMatch(/^2026-10-\d\dT/);

    // Idempotent: a second pass finds nothing new; the fixture page reaches 12 h before the cursor, so it stops there.
    const again = await runAgencySource(sql as never, fast(DOJ_ADAPTER), { fetchImpl: fixtureFetch(routes), sleep: noSleep });
    expect(again).toMatchObject({ status: "ok", itemsNew: 0, requests: 2 });
  });

  it("SEC: a matched case that is not published is linked but never shown; a 403 is recorded as blocked", async () => {
    const lrRss = fixture("sec-litigation-releases.rss.xml");
    const routes: Record<string, string | number> = {
      "https://www.sec.gov/robots.txt": "User-agent: *\nDisallow: /cgi-bin\n",
      "https://www.sec.gov/enforcement-litigation/litigation-releases/rss": lrRss,
      "https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26681": fixture("sec-lr-26681.html"),
      "https://www.sec.gov/enforcement-litigation/administrative-proceedings/rss": 403,
    };
    const [lr, ap] = SEC_ADAPTERS.map((adapter) => fast(adapter));
    const result = await runAgencySources(sql as never, [lr!, ap!], { fetchImpl: fixtureFetch(routes), sleep: noSleep });
    expect(result.reports[0]).toMatchObject({ source: "sec-litigation-releases", status: "partial", matched: 1 });
    expect(result.reports[1]).toMatchObject({ source: "sec-administrative-proceedings", status: "blocked" });
    expect(await listCaseAgencyItems(sql as never, "jv-agencyt05")).toEqual([]);
    const [health] = await sql<{ last_status: string; consecutive_failures: number }[]>`
      SELECT last_status, consecutive_failures FROM agency_source WHERE code = 'sec-administrative-proceedings'`;
    expect(health).toEqual({ last_status: "blocked", consecutive_failures: 1 });
  });

  it("never shows a restricted item even when its docket matches", async () => {
    await sql`UPDATE agency_source_item SET restricted = true, restricted_reason = 'test', review_status = 'queued'
      WHERE source_code = 'doj-press-releases' AND source_url LIKE '%usao-sdfl%'`;
    expect(await listCaseAgencyItems(sql as never, "jv-agencyt01")).toEqual([]);
  });

  it("settlements: JND listing, then the settlement website it names, both linked with amount and deadlines", async () => {
    const routes = {
      "https://www.jndla.com/robots.txt": "User-agent: *\nDisallow:\n",
      "https://www.jndla.com/cases": fixture("settlement-admin-jnd.html"),
      "https://www.celgenesecuritieslitigation.com/robots.txt": "",
      "https://www.celgenesecuritieslitigation.com/": fixture("settlement-site-celgene.html"),
    };
    const result = await runAgencySources(sql as never, [fast(JND_ADAPTER), fast(SETTLEMENT_SITES_ADAPTER)], { fetchImpl: fixtureFetch(routes), sleep: noSleep });
    expect(result.reports.map((report) => [report.source, report.status, report.matched])).toEqual([
      ["settlement-admin-jnd", "ok", 1], ["settlement-websites", "ok", 1],
    ]);
    const shown = await listCaseAgencyItems(sql as never, "jv-agencyt06");
    expect(shown.map((item) => [item.publisher, item.settlementAmount])).toEqual(expect.arrayContaining([
      ["JND Legal Administration", "$239M"], ["Court-approved settlement website", "$239M"],
    ]));
    expect(shown.find((item) => item.itemKind === "settlement_notice")?.keyDates.length).toBeGreaterThan(0);
    // JND is re-read at most every 20 hours.
    const again = await runAgencySources(sql as never, [fast(JND_ADAPTER)], { fetchImpl: fixtureFetch(routes), sleep: noSleep });
    expect(again.reports[0]).toMatchObject({ status: "ok", requests: 0 });
  });
});
