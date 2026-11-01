import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { recordCourtFetch } from "./court-fetch-log";
import { getCourtSourceMatrix, syncCourtSources } from "./court-source-matrix";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("court fetch log and source matrix", () => {
  it("records failures with status, flags zero items against the weekday baseline, and builds the matrix", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const url = `https://example.test/${randomUUID()}`;
    try {
      await syncCourtSources(sql);
      const [court] = await sql<{ court_code: string }[]>`SELECT court_code FROM court_source WHERE source = 'coa_feed' ORDER BY court_code LIMIT 1`;
      const courtCode = court!.court_code;
      // Seed a same-weekday baseline of 10 items.
      await sql`INSERT INTO court_fetch_log (source, court_code, url, fetched_at, http_status, ok, items)
        VALUES ('coa_feed', ${courtCode}, ${url}, now() - interval '7 days', 200, true, 10),
               ('coa_feed', ${courtCode}, ${url}, now() - interval '14 days', 200, true, 10)`;
      expect(await recordCourtFetch(sql, { source: "coa_feed", courtCode, url, startedAtMs: Date.now(), httpStatus: 200, ok: true, items: 0, newItems: 0 })).toBe(true);
      const [zero] = await sql<{ baseline_items: string; zero_vs_baseline: boolean }[]>`
        SELECT baseline_items, zero_vs_baseline FROM court_fetch_log WHERE url = ${url} ORDER BY id DESC LIMIT 1`;
      expect(Number(zero!.baseline_items)).toBe(10);
      expect(zero!.zero_vs_baseline).toBe(true);

      await recordCourtFetch(sql, { source: "coa_feed", courtCode, url, startedAtMs: Date.now(), httpStatus: 404, ok: false, error: "HTTP 404" });
      const matrix = await getCourtSourceMatrix(sql);
      const cell = matrix.find((row) => row.courtCode === courtCode && row.source === "coa_feed");
      expect(cell?.lastHttpStatus).toBe(404);
      expect(cell?.fetches24h).toBeGreaterThanOrEqual(2);
      expect(matrix.some((row) => row.source === "district_rss")).toBe(true);
      expect(matrix.some((row) => row.source === "pacer_free_opinions" && !row.enabled)).toBe(true);
    } finally {
      await sql`DELETE FROM court_fetch_log WHERE url = ${url}`;
      await sql.end();
    }
  });
});
