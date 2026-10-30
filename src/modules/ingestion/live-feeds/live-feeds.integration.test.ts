import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "../infrastructure/local-artifact-store";
import { runCoaCourt, runScotusLiveDockets } from "./run-live-feeds";

const databaseUrl = process.env.DATABASE_URL;
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

/** Serves fixture files for known URLs; anything else is a 404. */
function fixtureFetch(routes: Record<string, string>, calls: string[] = []) {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const body = routes[url];
    return body === undefined ? new Response("<html>not found</html>", { status: 404 }) : new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe.skipIf(!databaseUrl)("live feeds against Postgres", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  const store = new LocalArtifactStore(mkdtempSync(join(tmpdir(), "jurvio-live-feeds-")));
  const fast = { maxRequestsPerCourt: 4, maxMsPerCourt: 60_000, minIntervalMs: 0 };
  let existingCaseId = "";

  const cleanup = async () => {
    await sql`DELETE FROM legal_case WHERE id IN (
      SELECT legal_case.id FROM legal_case JOIN court ON court.id = legal_case.court_id
      WHERE lower(court.provider_court_id) IN ('cadc', 'scotus') AND (legal_case.public_id = 'jv-livefeed01'
        OR legal_case.source_artifact_id IN (SELECT id FROM raw_artifact WHERE source_record_id LIKE 'coa-feed:%' OR source_record_id LIKE 'docket-json:%')))`;
    await sql`DELETE FROM court_source_watermark WHERE court_code IN ('cadc', 'scotus')`;
  };

  beforeAll(async () => {
    await cleanup();
    const [cl] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const [court] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name)
      VALUES ('jc-livefeedcadc', ${cl!.id}, 'cadc', 'D.C. Circuit')
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = court.name RETURNING id`;
    // A CourtListener case already in Jurvio, written with a different docket format.
    const [existing] = await sql<{ id: string }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication)
      VALUES ('jv-livefeed01', ${court!.id}, '24 - 5231', 'California Valley Miwok Tribe v. Burgum', 'published')
      ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL DO UPDATE SET caption = EXCLUDED.caption
      RETURNING id`;
    existingCaseId = existing!.id;
  });

  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  it("cadc: attaches to the existing case, creates the rest as drafts, and is idempotent", async () => {
    const routes = { "https://media.cadc.uscourts.gov/opinions/rss.xml": fixture("cadc-opinions.rss.xml") };
    const first = await runCoaCourt(sql, store, "cadc", { fetchImpl: fixtureFetch(routes), coa: fast });
    expect(first).toMatchObject({ ok: true, itemsFetched: 15, requests: 1 });
    expect(first.newCases).toBe(14);
    expect(first.newEntries).toBe(15);

    const [existing] = await sql<{ entries: number; publication: string }[]>`
      SELECT count(entry.id)::int AS entries, legal_case.publication::text AS publication
      FROM legal_case LEFT JOIN docket_entry entry ON entry.case_id = legal_case.id
      WHERE legal_case.id = ${existingCaseId} GROUP BY legal_case.publication`;
    expect(existing).toEqual({ entries: 1, publication: "published" });

    const drafts = await sql<{ publication: string; verification: string }[]>`
      SELECT DISTINCT legal_case.publication::text AS publication, legal_case.verification::text AS verification
      FROM legal_case JOIN case_identifier identifier ON identifier.case_id = legal_case.id
      WHERE identifier.identifier_type = 'official_appellate_docket' AND identifier.identifier_value LIKE 'cadc:%'
        AND legal_case.id <> ${existingCaseId}`;
    expect(drafts).toEqual([{ publication: "draft", verification: "not_verified" }]);

    const again = await runCoaCourt(sql, store, "cadc", { fetchImpl: fixtureFetch(routes), coa: fast });
    expect(again).toMatchObject({ ok: true, itemsFetched: 15, newCases: 0, newEntries: 0 });

    const [mark] = await sql<{ cursor_value: string; items_fetched_total: number; consecutive_failures: number }[]>`
      SELECT cursor_value, items_fetched_total::int AS items_fetched_total, consecutive_failures FROM court_source_watermark
      WHERE source = 'coa_feed' AND court_code = 'cadc'`;
    expect(mark).toEqual({ cursor_value: "2026-10-23", items_fetched_total: 30, consecutive_failures: 0 });
  });

  it("a failing court records the failure and keeps its cursor", async () => {
    const failed = await runCoaCourt(sql, store, "cadc", { fetchImpl: fixtureFetch({}), coa: fast });
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/HTTP 404/);
    const [mark] = await sql<{ cursor_value: string; consecutive_failures: number }[]>`
      SELECT cursor_value, consecutive_failures FROM court_source_watermark WHERE source = 'coa_feed' AND court_code = 'cadc'`;
    expect(mark).toEqual({ cursor_value: "2026-10-23", consecutive_failures: 1 });
  });

  it("scotus: discovers dockets past the frontier as drafts with their entries", async () => {
    const calls: string[] = [];
    const routes = {
      "https://www.supremecourt.gov/RSS/Cases/JSON/26-1.json": fixture("scotus-26-1.json"),
      "https://www.supremecourt.gov/RSS/Cases/JSON/26-5900.json": fixture("scotus-26-5900.json"),
    };
    const result = await runScotusLiveDockets(sql, store, {
      fetchImpl: fixtureFetch(routes, calls), now: () => new Date("2026-10-30T12:00:00Z"),
      scotus: { maxRequests: 200, maxMs: 60_000, minIntervalMs: 0, backfillPerRun: 5 },
    });
    expect(result.ok).toBe(true);
    expect(result.itemsFetched).toBe(1); // 26-1 (26-5900 is not reachable from 26-5001 with a 3-number gap tolerance)
    expect(result.newCases).toBe(1);
    expect(result.newEntries).toBeGreaterThan(0);
    const [created] = await sql<{ publication: string; docket_number: string }[]>`
      SELECT legal_case.publication::text AS publication, legal_case.docket_number
      FROM legal_case JOIN case_identifier identifier ON identifier.case_id = legal_case.id
      WHERE identifier.identifier_type = 'scotus_docket' AND identifier.identifier_value = '26-1'`;
    expect(created).toEqual({ publication: "draft", docket_number: "26-1" });
    const [mark] = await sql<{ cursor_value: string }[]>`
      SELECT cursor_value FROM court_source_watermark WHERE source = 'scotus_official' AND court_code = 'scotus'`;
    expect(JSON.parse(mark!.cursor_value)["26-paid"]).toEqual({ high: 1, low: 1 });

    const second = await runScotusLiveDockets(sql, store, {
      fetchImpl: fixtureFetch(routes), now: () => new Date("2026-10-30T12:00:00Z"),
      scotus: { maxRequests: 200, maxMs: 60_000, minIntervalMs: 0, backfillPerRun: 5 },
    });
    expect(second).toMatchObject({ ok: true, newCases: 0, newEntries: 0 });
  });

  it("scotus: a 429 stops the source and records Retry-After", async () => {
    const limited = (async () => new Response("", { status: 429, headers: { "retry-after": "600" } })) as unknown as typeof fetch;
    const result = await runScotusLiveDockets(sql, store, { fetchImpl: limited,
      scotus: { maxRequests: 50, maxMs: 60_000, minIntervalMs: 0, backfillPerRun: 5 } });
    expect(result.ok).toBe(false);
    expect(result.requests).toBe(1);
    expect(result.retryAfterUntil).not.toBeNull();
    const [mark] = await sql<{ retry_after_until: Date | null; cursor_value: string }[]>`
      SELECT retry_after_until, cursor_value FROM court_source_watermark WHERE source = 'scotus_official' AND court_code = 'scotus'`;
    expect(mark!.retry_after_until).not.toBeNull();
    expect(JSON.parse(mark!.cursor_value)["26-paid"]).toEqual({ high: 1, low: 1 });
  });
});
