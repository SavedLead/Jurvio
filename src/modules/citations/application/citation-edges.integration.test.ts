import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { citationTestSchema } from "./test-migrations";
import { syncCitationGraph } from "./sync-citation-graph";
import { runCitationEdgeJob } from "./citation-edge-sweep";
import { caseCitationCounts, precomputedEdgesReady, relatedCitationCases } from "./public-citations";
import { markDirty, DIRTY_OUT } from "./citation-edges";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("precomputed citation edges and dirty counts (database)", () => {
  it("builds lists once, then keeps them current from the dirty set without exposing hidden or sealed cases", { timeout: 60_000 }, async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const fx = await citationTestSchema(sql, "citation_edges");
    const job = (extra: Partial<Parameters<typeof runCitationEdgeJob>[1]> = {}) => runCitationEdgeJob(sql, { budgetMs: 30_000, pauseMs: 0, ...extra });
    const ids = (rows: { casePublicId: string }[]) => rows.map((row) => row.casePublicId);
    try {
      const a = await fx.addCase("jv-edgesrca", null, "Alpha v. Agency");
      await fx.addCase("jv-edgetgtb", "347 U. S. 483", "Brown v. Board");
      await fx.addCase("jv-edgetgtc", "410 U. S. 113", "Charlie v. Delta");
      await fx.addCase("jv-edgeseal", "1 U. S. 1", "In re Sealed Matter");
      await fx.addCase("jv-edgehide", "2 U. S. 2", "Hidden v. Case", { publication: "restricted" });
      const h = await fx.addCase("jv-edgeclhh", null, "Hotel v. India");
      const docA = await fx.addOpinion(a, "See 347 U.S. 483; 410 U.S. 113; 1 U.S. 1; 2 U.S. 2; 999 F.3d 1.", { filedOn: "2020-01-01" });
      while (Object.values(await syncCitationGraph(sql, 100)).some(Boolean));

      expect(await precomputedEdgesReady(sql)).toBe(false);
      const first = await job();
      expect(first.sweep.state).toBe("completed");
      expect(await precomputedEdgesReady(sql)).toBe(true);
      expect(ids(await relatedCitationCases(sql, "jv-edgesrca", "cited")).sort()).toEqual(["jv-edgetgtb", "jv-edgetgtc"]);
      expect(ids(await relatedCitationCases(sql, "jv-edgetgtb", "citing"))).toEqual(["jv-edgesrca"]);
      expect(await relatedCitationCases(sql, "jv-edgeseal", "citing")).toEqual([]);
      expect(await caseCitationCounts(sql, "jv-edgesrca")).toEqual({ cited: 5, citedOnJurvio: 2, citedBy: 0 });
      expect(await caseCitationCounts(sql, "jv-edgetgtb")).toEqual({ cited: 0, citedOnJurvio: 0, citedBy: 1 });

      // A new citing opinion: only its case is recomputed, and it lists first (newest).
      const f = await fx.addCase("jv-edgenewf", null, "Foxtrot v. Golf");
      await fx.addOpinion(f, "Following 347 U.S. 483.", { filedOn: "2026-10-01" });
      while (Object.values(await syncCitationGraph(sql, 100)).some(Boolean));
      const dirty = await job();
      expect(dirty.sweep.state).toBe("idle");
      expect(dirty.dirty.outgoing).toBeGreaterThan(0);
      expect(ids(await relatedCitationCases(sql, "jv-edgetgtb", "citing"))).toEqual(["jv-edgenewf", "jv-edgesrca"]);
      expect((await caseCitationCounts(sql, "jv-edgetgtb")).citedBy).toBe(2);

      // Restricting the citing case removes it from counts and lists.
      await sql`UPDATE legal_case SET publication='restricted' WHERE id=${f}`;
      await job();
      expect(ids(await relatedCitationCases(sql, "jv-edgetgtb", "citing"))).toEqual(["jv-edgesrca"]);
      expect((await caseCitationCounts(sql, "jv-edgetgtb")).citedBy).toBe(1);

      // A competing identity (even a hidden one) makes the key ambiguous: no link.
      const g = await fx.addCase("jv-edgecolg", "347 U. S. 483", "Collision v. Case", { publication: "suppressed" });
      while (Object.values(await syncCitationGraph(sql, 100)).some(Boolean));
      await job();
      expect(await relatedCitationCases(sql, "jv-edgetgtb", "citing")).toEqual([]);
      expect((await caseCitationCounts(sql, "jv-edgetgtb")).citedBy).toBe(0);
      await sql`DELETE FROM legal_case WHERE id=${g}`;

      // CourtListener citation-map rows add depth and cases the parser cannot resolve.
      const c = (await sql<{ id: string }[]>`SELECT id FROM legal_case WHERE public_id='jv-edgetgtc'`)[0]!.id;
      await sql`INSERT INTO courtlistener_citation_edge(citing_document_id,cited_case_id,depth,snapshot_date) VALUES
        (${docA},${c},3,'2026-09-30'), (${docA},${h},1,'2026-09-30')`;
      await markDirty(sql, [a], DIRTY_OUT);
      await job();
      const [edgeC] = await sql<{ sources: number; depth: number }[]>`SELECT sources, depth FROM case_citation_edge WHERE citing_case_id=${a} AND cited_case_id=${c}`;
      expect(edgeC).toEqual({ sources: 3, depth: 3 });
      expect(ids(await relatedCitationCases(sql, "jv-edgeclhh", "citing"))).toEqual(["jv-edgesrca"]);
      expect(await caseCitationCounts(sql, "jv-edgesrca")).toEqual({ cited: 6, citedOnJurvio: 3, citedBy: 0 });
      const listed = await relatedCitationCases(sql, "jv-edgesrca", "cited");
      expect(listed.find((row) => row.casePublicId === "jv-edgeclhh")?.citationLabel).toBe("");

      // The dirty queue is empty and a forced sweep converges to the same state.
      expect(await sql`SELECT 1 FROM citation_dirty_case`).toHaveLength(0);
      const before = await sql`SELECT citing_case_id, cited_case_id, sources FROM case_citation_edge ORDER BY 1, 2`;
      const again = await job({ forceSweep: true });
      expect(again.sweep.state).toBe("completed");
      expect(await sql`SELECT citing_case_id, cited_case_id, sources FROM case_citation_edge ORDER BY 1, 2`).toEqual(before);

      // A bulk import requests a sweep: it runs outside off-peak hours, once.
      const idle = { offPeakHours: [0, 0] as [number, number] };
      expect((await job(idle)).sweep.state).not.toBe("started");
      await sql`UPDATE citation_edge_build SET sweep_requested_at = now() WHERE id`;
      expect((await job(idle)).sweep.state).toBe("completed");
      expect((await job(idle)).sweep.state).not.toBe("completed");
    } finally {
      await fx.drop();
      await sql.end();
    }
  });
});
