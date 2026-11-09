import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "../infrastructure/local-artifact-store";
import { runAppellatePacerRss, runCourtSiteOpinions } from "./free-sources";
import { appellateRssUrl } from "../providers/appellate/pacer-rss";

const databaseUrl = process.env.DATABASE_URL;
const fixture = (name: string, encoding: BufferEncoding = "utf8") => readFileSync(join(__dirname, "fixtures", name), encoding);

function routes(map: Record<string, string>) {
  return (async (input: string | URL) => {
    const body = map[String(input)];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe.skipIf(!databaseUrl)("court-site opinions and appellate RSS against Postgres", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  const store = new LocalArtifactStore(mkdtempSync(join(tmpdir(), "jurvio-free-sources-")));
  const now = new Date("2026-10-31T16:00:00Z");
  let wvsdMatched = "";
  let wvsdEntry = "";

  const cleanup = async () => {
    await sql`DELETE FROM legal_case WHERE public_id LIKE 'jv-freesrc%' OR source_artifact_id IN (
      SELECT id FROM raw_artifact WHERE source_record_id LIKE 'court-site:%' OR source_record_id LIKE 'appellate-rss:%')`;
    await sql`DELETE FROM free_source_item WHERE source IN ('court_site', 'appellate_pacer_rss')`;
    await sql`DELETE FROM court_fetch_log WHERE source IN ('court_site', 'appellate_pacer_rss')`;
    await sql`DELETE FROM court_source_watermark WHERE source IN ('court_site', 'appellate_pacer_rss')`;
  };

  beforeAll(async () => {
    await cleanup();
    const [cl] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const [court] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name) VALUES ('jc-freesrcwvsd', ${cl!.id}, 'wvsd', 'S.D. W. Va.')
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = court.name RETURNING id`;
    const [a] = await sql<{ id: string }[]>`INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-freesrc01', ${court!.id}, '2:26-cv-00679-JTJ', 'West Virginia Rivers Coalition v. McCuskey', 'draft') RETURNING id`;
    wvsdMatched = a!.id;
    // The district RSS already carried this order.
    await sql`INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number, filed_on, description)
      VALUES ('jd-freesrc01', ${wvsdMatched}, ${cl!.id}, 'rss:wvsd:freesrc', '40', '2026-10-29', 'MEMORANDUM OPINION AND ORDER granting injunction')`;
    const [b] = await sql<{ id: string }[]>`INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-freesrc02', ${court!.id}, '2:25-cv-00752', 'Fox v. Herbert J. Thomas Memorial Hospital', 'draft') RETURNING id`;
    wvsdEntry = b!.id;
  });

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM court WHERE public_id = 'jc-freesrcwvsd'`;
    await sql.end();
  });

  it("court site: matches what the RSS already has, adds the rest, creates cases only from full dockets, idempotent", async () => {
    const sealedPage = `<div class="view-content"><div class="views-row views-row-1"><div class="views-field views-field-title"><span class="field-content">
      <a href="https://www.pamd.uscourts.gov/sites/pamd/files/opinions/26mj5.pdf">1:26-MJ-00005 In re Sealed Search Warrant
      <span property="dc:date" content="2026-10-30T00:00:00-04:00" class="date-display-single">10/30/2026</span></a></span></div></div></div>`;
    const fetchImpl = routes({
      "https://www.wvsd.uscourts.gov/judges-info/opinions": fixture("court-site/wvsd-opinions.html"),
      "https://www.pamd.uscourts.gov/judges-info/opinions": sealedPage,
      "https://www.nhd.uscourts.gov/opinions": fixture("court-site/nhd-opinions.html"),
    });
    const results = await runCourtSiteOpinions(sql, store, { fetchImpl, now, courts: ["wvsd", "pamd", "nhd"] });
    const by = Object.fromEntries(results.map((row) => [row.court, row]));
    // wvsd: 10 listed, 2 in the last 60 days: one already on the case from the RSS, one added to the existing case.
    expect(by.wvsd).toMatchObject({ ok: true, items: 10 });
    expect(by.wvsd!.outcomes).toMatchObject({ matched: 1, entry: 1, new_case: 0, too_old: 8 });
    expect(by.pamd!.outcomes).toMatchObject({ restricted: 1, new_case: 0, entry: 0 });
    // nhd gives no office number, so with no existing case nothing is created.
    expect(by.nhd!.outcomes).toMatchObject({ unmatched: 10, new_case: 0 });

    const entries = await sql<{ case_id: string; entry_number: string | null }[]>`
      SELECT case_id, entry_number FROM docket_entry WHERE provider_entry_id LIKE 'court-site:%'`;
    expect(entries).toEqual([{ case_id: wvsdEntry, entry_number: null }]);
    expect(await sql`SELECT 1 FROM legal_case WHERE caption ILIKE '%sealed%'`).toHaveLength(0);

    const again = await runCourtSiteOpinions(sql, store, { fetchImpl, now, courts: ["wvsd"] });
    expect(again[0]!.outcomes).toMatchObject({ seen_before: 2, entry: 0, matched: 0 });

    const failing = await runCourtSiteOpinions(sql, store, { fetchImpl: routes({}), now, courts: ["vid"] });
    expect(failing[0]).toMatchObject({ ok: false });
    const [log] = await sql<{ http_status: number; ok: boolean }[]>`
      SELECT http_status, ok FROM court_fetch_log WHERE source = 'court_site' AND court_code = 'vid' ORDER BY id DESC LIMIT 1`;
    expect(log).toEqual({ http_status: 404, ok: false });
  });

  it("appellate RSS: one entry per docket entry, sealed skipped, same-day duplicates from other sources skipped", async () => {
    const fetchImpl = routes({ [appellateRssUrl("cadc")]: fixture("cadc-appellate-rss.xml", "latin1"),
      [appellateRssUrl("ca9")]: "<rss><channel><description>not configured for feed</description></channel></rss>" });
    const [cadc] = await runAppellatePacerRss(sql, store, { fetchImpl, courts: ["cadc"] });
    expect(cadc).toMatchObject({ ok: true, items: 4 });
    expect(cadc!.outcomes).toMatchObject({ new_case: 2, entry: 1, restricted: 1, matched: 0 });
    const rows = await sql<{ docket_number: string; description: string; entry_type: string; publication: string }[]>`
      SELECT legal_case.docket_number, docket_entry.description, docket_entry.entry_type, legal_case.publication::text
      FROM docket_entry JOIN legal_case ON legal_case.id = docket_entry.case_id
      WHERE docket_entry.provider_entry_id LIKE 'appellate-rss:cadc:%' ORDER BY 1, 2`;
    expect(rows).toEqual([
      { docket_number: "25-1150", description: "Judgment Filed", entry_type: "order", publication: "published" },
      { docket_number: "25-1150", description: "Opinion Filed for the Court by Judge Pillard", entry_type: "opinion", publication: "published" },
      { docket_number: "26-1287", description: "Per Curiam Order Filed Special Panel", entry_type: "order", publication: "published" },
    ]);
    expect(await sql`SELECT 1 FROM legal_case WHERE docket_number = '26-3001'`).toHaveLength(0);
    const [again] = await runAppellatePacerRss(sql, store, { fetchImpl, courts: ["cadc"] });
    expect(again!.outcomes).toMatchObject({ seen_before: 4, entry: 0, new_case: 0 });
  });
});
