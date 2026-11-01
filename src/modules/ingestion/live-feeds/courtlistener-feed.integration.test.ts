import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "../infrastructure/local-artifact-store";
import { runCourtListenerFeeds } from "./free-sources";
import { courtListenerFeedUrl } from "../providers/courts/courtlistener-feed";

const databaseUrl = process.env.DATABASE_URL;
const fixture = (court: string) => readFileSync(join(__dirname, "fixtures", "courtlistener", `${court}.atom.xml`), "utf8");

function routes(map: Record<string, string>) {
  return (async (input: string | URL) => {
    const body = map[String(input)];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe.skipIf(!databaseUrl)("CourtListener court feeds against Postgres", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  const store = new LocalArtifactStore(mkdtempSync(join(tmpdir(), "jurvio-cl-feed-")));
  const now = new Date("2026-11-01T08:00:00Z");
  let matchedCase = "";
  let entryCase = "";

  const cleanup = async () => {
    await sql`DELETE FROM docket_entry WHERE provider_entry_id LIKE 'cl-feed:%' OR provider_entry_id = 'rss:vaed:clfeed'`;
    await sql`DELETE FROM legal_case WHERE public_id LIKE 'jv-clfeed%' OR source_artifact_id IN (
      SELECT id FROM raw_artifact WHERE source_record_id LIKE 'cl-feed:%')`;
    await sql`DELETE FROM free_source_item WHERE source = 'courtlistener_feed'`;
    await sql`DELETE FROM court_fetch_log WHERE source = 'courtlistener_feed'`;
    await sql`DELETE FROM court_source_watermark WHERE source = 'courtlistener_feed'`;
  };

  beforeAll(async () => {
    await cleanup();
    const [cl] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const [court] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name) VALUES ('jc-clfeedvaed', ${cl!.id}, 'vaed', 'E.D. Va.')
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = court.name RETURNING id`;
    const [a] = await sql<{ id: string }[]>`INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-clfeed01', ${court!.id}, '1:25-cv-01708-MSN-WBP', 'Jones v. Phelan', 'draft') RETURNING id`;
    matchedCase = a!.id;
    // The district RSS already carried this opinion the day before.
    await sql`INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number, filed_on, description)
      VALUES ('jd-clfeed01', ${matchedCase}, ${cl!.id}, 'rss:vaed:clfeed', '21', '2026-10-29', 'MEMORANDUM OPINION AND ORDER dismissing the complaint')`;
    const [b] = await sql<{ id: string }[]>`INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-clfeed02', ${court!.id}, '3:23-cv-00801', 'Byers v. Painter', 'draft') RETURNING id`;
    entryCase = b!.id;
  });

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM court WHERE public_id = 'jc-clfeedvaed'`;
    await sql.end();
  });

  it("matches what another source has, adds the rest, creates cases only from full dockets, idempotent", async () => {
    const fetchImpl = routes({ [courtListenerFeedUrl("vaed")]: fixture("vaed"), [courtListenerFeedUrl("oknd")]: fixture("oknd") });
    const results = await runCourtListenerFeeds(sql, store, { fetchImpl, now, courts: ["vaed", "oknd"] });
    const by = Object.fromEntries(results.map((row) => [row.court, row]));
    expect(by.vaed).toMatchObject({ ok: true, items: 20, source: "courtlistener_feed" });
    expect(by.vaed!.outcomes.matched).toBe(1);
    expect(by.vaed!.outcomes.entry).toBe(1);
    expect(by.vaed!.outcomes.unmatched).toBe(3);
    expect(by.vaed!.outcomes.new_case + by.vaed!.outcomes.restricted).toBe(15);
    // Most oknd headers give no office number, so only the one full docket (4:17-cv-00336) may create a case.
    expect(by.oknd!.outcomes).toMatchObject({ new_case: 1, entry: 0 });
    expect(by.oknd!.outcomes.unmatched).toBeGreaterThanOrEqual(15);

    const entries = await sql<{ case_id: string; entry_number: string | null; entry_type: string }[]>`
      SELECT case_id, entry_number, entry_type FROM docket_entry WHERE provider_entry_id LIKE 'cl-feed:vaed:%' AND case_id = ${entryCase}`;
    expect(entries).toEqual([{ case_id: entryCase, entry_number: "242", entry_type: "opinion" }]);
    expect(await sql`SELECT 1 FROM docket_entry WHERE case_id = ${matchedCase} AND provider_entry_id LIKE 'cl-feed:%'`).toHaveLength(0);
    const created = await sql<{ publication: string }[]>`
      SELECT legal_case.publication::text FROM legal_case JOIN case_identifier ci ON ci.case_id = legal_case.id
      WHERE ci.identifier_type = 'courtlistener_feed_docket'`;
    expect(created.length).toBe(by.vaed!.outcomes.new_case + by.oknd!.outcomes.new_case);
    expect(created.every((row) => row.publication === "draft")).toBe(true);

    const [again] = await runCourtListenerFeeds(sql, store, { fetchImpl, now, courts: ["vaed"] });
    expect(again!.outcomes).toMatchObject({ seen_before: 20, entry: 0, new_case: 0 });
    const [log] = await sql<{ ok: boolean; items: number }[]>`
      SELECT ok, items FROM court_fetch_log WHERE source = 'courtlistener_feed' AND court_code = 'vaed' ORDER BY id DESC LIMIT 1`;
    expect(log).toEqual({ ok: true, items: 20 });
    const [mark] = await sql<{ source: string }[]>`SELECT source FROM court_source_watermark WHERE source = 'courtlistener_feed' AND court_code = 'vaed'`;
    expect(mark).toEqual({ source: "courtlistener_feed" });
  });
});
