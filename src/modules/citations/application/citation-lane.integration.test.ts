import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { citationTestSchema } from "./test-migrations";
import { citationBacklog, runCitationLane } from "./citation-lane";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("citation lane priority and budget (database)", () => {
  it("parses new opinions ahead of the backfill and loops until the queue is empty", { timeout: 60_000 }, async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const fx = await citationTestSchema(sql, "citation_lane");
    try {
      const source = await fx.addCase("jv-lanesrc1", null, "Source v. Agency");
      await fx.addCase("jv-lanetgt1", "347 U. S. 483", "Brown v. Board");
      const old: string[] = [];
      for (let i = 0; i < 5; i++) old.push(await fx.addOpinion(source, `Backfill ${i} cites 347 U.S. 483.`));
      // Rows queued before migration 0170 (and bulk requeues) are backfill.
      await sql`UPDATE document_citation_work SET priority=0, queued_at='2026-01-01'`;
      await sql`UPDATE case_citation_work SET priority=0, queued_at='2026-01-01'`;
      const fresh = await fx.addOpinion(source, "A new opinion citing 347 U.S. 483.");
      const [queued] = await sql<{ priority: number }[]>`SELECT priority FROM document_citation_work WHERE document_id=${fresh}`;
      expect(queued?.priority).toBe(10);

      // One-batch run of 1 row: the new opinion goes first even though it is newest.
      await runCitationLane(sql, { batch: 1, budgetMs: 0, pauseMs: 0, backfillBatches: 1 });
      expect(await sql`SELECT 1 FROM document_citation_work WHERE document_id=${fresh}`).toHaveLength(0);
      expect(await sql`SELECT 1 FROM document_case_citation WHERE document_id=${fresh}`).toHaveLength(1);

      // Builder backfill mode never takes live rows.
      const fresh2 = await fx.addOpinion(source, "Another live one, 347 U.S. 483.");
      const backfill = await runCitationLane(sql, { batch: 2, budgetMs: 30_000, pauseMs: 0, backfillBatches: Infinity, backfillOnly: true });
      expect(backfill.liveBatches).toBe(0);
      expect(await sql`SELECT 1 FROM document_citation_work WHERE document_id=${fresh2}`).toHaveLength(1);
      expect(await sql`SELECT 1 FROM document_citation_work WHERE priority=0`).toHaveLength(0);
      expect(backfill.stoppedBy).toBe("empty");

      // Resident mode with a budget drains live work, then stops after N backfill batches.
      for (let i = 0; i < 4; i++) await fx.addOpinion(source, `More backfill ${i} 347 U.S. 483.`);
      await sql`UPDATE document_citation_work SET priority=0 WHERE document_id<>${fresh2}`;
      const resident = await runCitationLane(sql, { batch: 1, budgetMs: 30_000, pauseMs: 0, backfillBatches: 2 });
      expect(resident.liveBatches).toBe(1);
      expect(resident.stoppedBy).toBe("backfill_batches");
      const backlog = await citationBacklog(sql);
      expect(backlog.documents_live).toBe(0);
      expect((await sql`SELECT 1 FROM document_citation_work`).length).toBe(2);

      // A spent budget stops before starting another batch.
      let clock = 0;
      const spent = await runCitationLane(sql, { batch: 1, budgetMs: 10, pauseMs: 0, backfillBatches: Infinity }, () => (clock += 20));
      expect(spent.batches).toBe(0);
      expect(spent.stoppedBy).toBe("budget");
      expect(old).toHaveLength(5);
    } finally {
      await fx.drop();
      await sql.end();
    }
  });
});
