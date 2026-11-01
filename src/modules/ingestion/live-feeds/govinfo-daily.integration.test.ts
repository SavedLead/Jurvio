import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "../infrastructure/local-artifact-store";
import { runGovInfoDaily } from "./govinfo-daily";

const databaseUrl = process.env.DATABASE_URL;
// 30 real packages from /collections/USCOURTS (2026-10-31) plus synthetic ca5 and caDC packages and a sealed nywd package.
const PAGE = readFileSync(join(__dirname, "fixtures", "govinfo-uscourts-collection.json"), "utf8");

describe.skipIf(!databaseUrl)("GovInfo USCOURTS daily source against Postgres", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  const store = new LocalArtifactStore(mkdtempSync(join(tmpdir(), "jurvio-govinfo-")));
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(PAGE, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  let matchedCase = "";
  let entryCase = "";

  const cleanup = async () => {
    await sql`DELETE FROM legal_case WHERE public_id LIKE 'jv-govinfo%' OR source_artifact_id IN (
      SELECT id FROM raw_artifact WHERE source_record_id = 'govinfo:uscourts')`;
    await sql`DELETE FROM govinfo_crosscheck`;
    await sql`DELETE FROM govinfo_daily_state`;
    await sql`DELETE FROM court_fetch_log WHERE source = 'govinfo'`;
    await sql`DELETE FROM court_source_watermark WHERE source = 'govinfo'`;
  };

  beforeAll(async () => {
    await cleanup();
    const [cl] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const [court] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name)
      VALUES ('jc-govinfomdd', ${cl!.id}, 'mdd', 'District of Maryland')
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = court.name RETURNING id`;
    // Stored by the district RSS with a judge suffix, and already has the order from that source.
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-govinfo01', ${court!.id}, '1:26-cv-04297-ABA', '3 Dimensional Wealth Advisory LLC v. Barberis', 'draft') RETURNING id`;
    matchedCase = a!.id;
    await sql`INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number, filed_on, description)
      VALUES ('jd-govinfo01', ${matchedCase}, ${cl!.id}, 'rss:mdd:1', '12', '2026-10-30', 'MEMORANDUM OPINION and ORDER granting motion to dismiss')`;
    const [b] = await sql<{ id: string }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-govinfo02', ${court!.id}, '1:25-cv-03601', 'Spahr v. Bisignano', 'draft') RETURNING id`;
    entryCase = b!.id;
    // Same year and number, different case type: must not make the match ambiguous.
    await sql`INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-govinfo03', ${court!.id}, '1:25-cr-03601', 'USA v. Someone', 'draft')`;
  });

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM court WHERE public_id = 'jc-govinfomdd'`;
    await sql.end();
  });

  it("cross-checks every package, adds only what no other source had, never stores sealed captions, and is idempotent", async () => {
    const first = await runGovInfoDaily(sql, store, { apiKey: "", fetchImpl, now: new Date("2026-10-31T23:30:00Z") });
    expect(first).toMatchObject({ ok: true, credential: "demo", requests: 1, packages: 33, tracked: 33, sweepComplete: true });
    expect(first.outcomes).toEqual({ matched: 1, entry: 1, new_case: 30, restricted: 1, ambiguous: 0, seen_before: 0 });
    expect(calls[0]).toContain("/collections/USCOURTS/2026-10-29T23:30:00Z?offsetMark=*&pageSize=1000&api_key=DEMO_KEY");

    const govinfoEntries = await sql<{ case_id: string; filed_on: string }[]>`
      SELECT case_id, filed_on::text FROM docket_entry WHERE provider_entry_id LIKE 'govinfo:%'`;
    expect(govinfoEntries).toHaveLength(31);
    expect(govinfoEntries.some((row) => row.case_id === matchedCase)).toBe(false);
    expect(govinfoEntries.filter((row) => row.case_id === entryCase)).toEqual([{ case_id: entryCase, filed_on: "2026-10-30" }]);

    const sealed = await sql`SELECT 1 FROM legal_case WHERE caption ILIKE '%sealed%' OR docket_number = '1:26-mj-00001'`;
    expect(sealed).toHaveLength(0);
    const created = await sql<{ publication: string; verification: string }[]>`
      SELECT DISTINCT publication::text, verification::text FROM legal_case
      WHERE source_artifact_id IN (SELECT id FROM raw_artifact WHERE source_record_id = 'govinfo:uscourts')`;
    expect(created).toEqual([{ publication: "draft", verification: "not_verified" }]);
    const circuit = await sql<{ docket_number: string; code: string }[]>`
      SELECT legal_case.docket_number, court.provider_court_id AS code FROM govinfo_crosscheck
      JOIN legal_case ON legal_case.id = govinfo_crosscheck.case_id JOIN court ON court.id = legal_case.court_id
      WHERE govinfo_crosscheck.court_code IN ('ca5', 'cadc') ORDER BY 1`;
    expect(circuit).toEqual([{ docket_number: "26-90001", code: "ca5" }, { docket_number: "26-9002", code: "cadc" }]);

    // The key never reaches the database; every court gets a matrix row.
    const logged = await sql<{ court_code: string; url: string; items: number }[]>`
      SELECT court_code, url, items FROM court_fetch_log WHERE source = 'govinfo'`;
    expect(logged.every((row) => !row.url.includes("api_key"))).toBe(true);
    expect(logged.filter((row) => row.court_code !== "_all")).toHaveLength(13 + 94);
    expect(logged.find((row) => row.court_code === "mdd")?.items).toBe(6);
    expect(logged.find((row) => row.court_code === "_all")?.items).toBe(33);

    const second = await runGovInfoDaily(sql, store, { apiKey: "", fetchImpl, now: new Date("2026-11-01T00:30:00Z") });
    expect(second.outcomes).toEqual({ matched: 0, entry: 0, new_case: 0, restricted: 0, ambiguous: 0, seen_before: 33 });
    const [total] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM docket_entry WHERE provider_entry_id LIKE 'govinfo:%'`;
    expect(total?.count).toBe(31);
    const [state] = await sql<{ since: string; offset_mark: string | null; sweeps_completed: number }[]>`
      SELECT since::text, offset_mark, sweeps_completed FROM govinfo_daily_state`;
    expect(state).toMatchObject({ offset_mark: null, sweeps_completed: 2 });
    // Next sweep starts an hour before the newest lastModified in the page (2026-10-31T23:03:34Z).
    expect(new Date(state!.since).toISOString()).toBe("2026-10-31T22:03:34.000Z");
  });

  it("a failed request is logged with its status and leaves the cursor alone", async () => {
    const [before] = await sql<{ since: string }[]>`SELECT since::text FROM govinfo_daily_state`;
    const failing = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const result = await runGovInfoDaily(sql, store, { apiKey: "", fetchImpl: failing });
    expect(result.ok).toBe(false);
    const [row] = await sql<{ http_status: number; ok: boolean }[]>`
      SELECT http_status, ok FROM court_fetch_log WHERE source = 'govinfo' AND court_code = '_all' ORDER BY id DESC LIMIT 1`;
    expect(row).toEqual({ http_status: 429, ok: false });
    const [after] = await sql<{ since: string }[]>`SELECT since::text FROM govinfo_daily_state`;
    expect(after!.since).toBe(before!.since);
  });
});
