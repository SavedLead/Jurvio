import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { loadCourtListenerBulkDockets, mergeDocketStage, stageCsv, stageDocket } from "./bulk-docket-load";
import type { CourtListenerBulkDocket } from "../providers/courtlistener/bulk-dockets";

const databaseUrl = process.env.DATABASE_URL;

/** Clock that advances 1ms per call and jumps past the deadline after `ticks` calls. */
function expiringClock(ticks: number, budgetMs: number): () => number {
  let calls = 0;
  return () => {
    calls += 1;
    return calls > ticks ? 1_000_000 + budgetMs * 10 : 1_000_000 + calls;
  };
}

// One file: both tests TRUNCATE the shared courtlistener_docket_stage table.
describe.skipIf(!databaseUrl)("bulk docket merge", () => {
  it("inserts a draft case from a staged row and does not publish it", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const courtCode = `zzb${randomUUID().slice(0, 8)}`;
    const docketNumber = `9:26-cv-${randomUUID().slice(0, 6)}`;
    try {
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
      expect(provider?.id).toBeTruthy();
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-${courtCode}`}, ${provider!.id}, ${courtCode}, ${courtCode}, 'FD', 'not_verified')
        RETURNING id
      `;
      const staged = stageDocket({
        id: String(9_000_000_000 + Math.floor(Math.random() * 1_000_000)),
        court_id: courtCode,
        docket_number: docketNumber,
        case_name: "Bulk Measurement v. Example",
        date_filed: "2026-03-01",
        date_terminated: "",
        date_modified: "2026-03-02T00:00:00Z",
        cause: "",
        nature_of_suit: "440",
      } as CourtListenerBulkDocket);
      expect(staged).not.toBeNull();
      const counts = await mergeDocketStage(sql, provider!.id, stageCsv([staged!]));
      expect(counts.inserted).toBe(1);
      const [row] = await sql<{ publication: string; decisions: number; indexed: number }[]>`
        SELECT legal_case.publication::text AS publication,
          (SELECT count(*)::int FROM publication_decision
            WHERE object_type = 'legal_case' AND object_id = legal_case.id) AS decisions,
          (SELECT count(*)::int FROM opinion_search_projection
            WHERE case_id = legal_case.id) AS indexed
        FROM legal_case
        WHERE court_id = ${court!.id} AND docket_number = ${docketNumber}
      `;
      expect(row?.publication).toBe("draft");
      expect(row?.decisions).toBe(0);
      expect(row?.indexed).toBe(0);
    } finally {
      await sql`
        DELETE FROM legal_case
        WHERE court_id IN (SELECT id FROM court WHERE provider_court_id = ${courtCode})
      `;
      await sql`DELETE FROM court WHERE provider_court_id = ${courtCode}`;
      await sql.end();
    }
  });
  it("does not skip unmerged rows when the budget ends mid-chunk, and row_limit is per run", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const courtCode = `zzr${randomUUID().slice(0, 8)}`;
    const snapshotDate = "2099-01-01";
    const dir = mkdtempSync(join(tmpdir(), "bulk-dockets-"));
    const file = join(dir, "dockets.csv");
    const base = 8_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const header = "id,court_id,docket_number,case_name,date_filed,date_terminated,date_modified,cause,nature_of_suit";
    const rows = Array.from({ length: 12 }, (_, index) =>
      `${base + index},${courtCode},1:99-cv-${String(index).padStart(5, "0")},Resume ${index} v. Example,2026-01-01,,2026-01-02T00:00:00Z,,440`);
    writeFileSync(file, `${header}\n${rows.join("\n")}\n`);
    const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const stream = `courtlistener:bulk-dockets:v1:${snapshotDate}`;
    const count = async () => {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM legal_case
        WHERE court_id IN (SELECT id FROM court WHERE provider_court_id = ${courtCode})`;
      return row!.n;
    };
    try {
      await sql`
        INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-${courtCode}`}, ${provider!.id}, ${courtCode}, ${courtCode}, 'FD', 'not_verified')`;
      await sql`DELETE FROM ingestion_checkpoint WHERE provider_id = ${provider!.id} AND stream_name = ${stream}`;
      const common = { filePath: file, snapshotDate, chunkSize: 5, allowAnytime: true, diskPath: dir };

      // Run 1: the budget expires after the first chunk (5 rows) while rows 6-7 sit unmerged.
      const first = await loadCourtListenerBulkDockets(sql, {
        ...common, rowLimit: 1_000, budgetMs: 1_000, now: expiringClock(10, 1_000),
      });
      expect(first.stopped).toBe("budget");
      expect(first.merged).toBe(5);
      expect(first.rowsConsumed).toBe(5);
      expect(await count()).toBe(5);

      // Run 2: row_limit counts this run only, so it merges 5 more even though 5 are already merged.
      const second = await loadCourtListenerBulkDockets(sql, { ...common, rowLimit: 5, budgetMs: 60_000 });
      expect(second.resumedFromRow).toBe(5);
      expect(second.mergedThisRun).toBe(5);
      expect(second.stopped).toBe("row-limit");
      expect(await count()).toBe(10);

      // Run 3: finishes the file; nothing was skipped.
      const third = await loadCourtListenerBulkDockets(sql, { ...common, rowLimit: 1_000, budgetMs: 60_000 });
      expect(third, JSON.stringify(third)).toMatchObject({ stopped: "complete" });
      expect(third.mergedThisRun).toBe(2);
      expect(third.insertedThisRun).toBe(2);
      expect(third.rowsConsumed).toBe(12);
      expect(await count()).toBe(12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await sql`DELETE FROM ingestion_checkpoint WHERE provider_id = ${provider!.id} AND stream_name = ${stream}`;
      await sql`
        DELETE FROM case_identifier WHERE case_id IN (
          SELECT id FROM legal_case WHERE court_id IN (SELECT id FROM court WHERE provider_court_id = ${courtCode}))`;
      await sql`DELETE FROM legal_case WHERE court_id IN (SELECT id FROM court WHERE provider_court_id = ${courtCode})`;
      await sql`DELETE FROM court WHERE provider_court_id = ${courtCode}`;
      await sql.end();
    }
  });
});
