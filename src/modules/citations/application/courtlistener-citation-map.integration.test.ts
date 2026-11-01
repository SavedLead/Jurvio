import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { runCitationEdgeJob } from "./citation-edge-sweep";
import {
  finalizeCitationMap, importCitationMap, importOpinionClusterMap, importParentheticals,
  loadHeldOpinionIds, loadUnmappedOpinionIds,
} from "./courtlistener-citation-map";
import { relatedCitationCases } from "./public-citations";
import { citationTestSchema } from "./test-migrations";

const url = process.env.DATABASE_URL;
async function* rows(records: Record<string, string>[]) { for (const record of records) yield record; }
async function* pairs(values: [number, number][]) { for (const value of values) yield value; }

describe.skipIf(!url)("CourtListener citation map import (database)", () => {
  it("imports edges, keeps unresolved rows compact, maps clusters and folds into visible lists", { timeout: 60_000 }, async () => {
    const sql = postgres(url!, { max: 1, onnotice: () => undefined });
    const fx = await citationTestSchema(sql, "clmap");
    try {
      const throttle = { batch: 2, pauseMs: 0, maxActive: 1000, deadline: Date.now() + 60_000 };
      const a = await fx.addCase("jv-clmapcasea", null, "Alpha v. Beta");
      const b = await fx.addCase("jv-clmapcaseb", null, "Gamma v. Delta");
      const sealed = await fx.addCase("jv-clmapseald", null, "United States v. Sealed Defendant");
      const later = await fx.addCase("jv-clmaplater", null, "Epsilon v. Zeta");
      const docA = await fx.addClOpinion(a, 1001, 11, "Opinion A");
      await fx.addClOpinion(a, 1001, 12, "Dissent A");
      await fx.addClOpinion(b, 1002, 21, "Opinion B");
      await fx.addClOpinion(sealed, 1003, 31, "Sealed opinion");
      const held = await loadHeldOpinionIds(sql);
      expect(Array.from(held.ids)).toEqual([11, 12, 21, 31]);

      const map = [
        { id: "1", depth: "3", cited_opinion_id: "21", citing_opinion_id: "11" },  // A -> B, both held
        { id: "2", depth: "1", cited_opinion_id: "11", citing_opinion_id: "12" },  // same case: skipped
        { id: "3", depth: "2", cited_opinion_id: "31", citing_opinion_id: "11" },  // A -> sealed (held, hidden later)
        { id: "4", depth: "5", cited_opinion_id: "77", citing_opinion_id: "11" },  // A -> unknown opinion 77
        { id: "5", depth: "1", cited_opinion_id: "88", citing_opinion_id: "11" },  // A -> unknown opinion 88
        { id: "6", depth: "4", cited_opinion_id: "21", citing_opinion_id: "99" },  // citing not held: dropped
      ];
      const dry = await importCitationMap(sql, rows(map), { snapshot: "2026-09-30", held, dryRun: true, throttle });
      expect(dry).toMatchObject({ rowsRead: 6, citingHeld: 5, bothHeld: 3, citedNotHeld: 2 });
      expect(await sql`SELECT 1 FROM courtlistener_citation_edge`).toHaveLength(0);

      const stats = await importCitationMap(sql, rows(map), { snapshot: "2026-09-30", held, dryRun: false, throttle });
      expect(stats).toMatchObject({ edgesWritten: 2, unresolvedWritten: 2 });
      // Idempotent: a completed phase is not re-run.
      expect((await importCitationMap(sql, rows(map), { snapshot: "2026-09-30", held, dryRun: false, throttle })).edgesWritten).toBe(0);
      expect(await sql`SELECT cited_case_id, depth FROM courtlistener_citation_edge ORDER BY depth`)
        .toEqual([{ cited_case_id: sealed, depth: 2 }, { cited_case_id: b, depth: 3 }]);

      await importParentheticals(sql, rows([
        { id: "501", text: "holding  that X", score: "0.9", described_opinion_id: "21", describing_opinion_id: "11", group_id: "7" },
        { id: "502", text: "explaining Y", score: "0.4", described_opinion_id: "77", describing_opinion_id: "11", group_id: "" },
        { id: "503", text: "dropped", score: "0.4", described_opinion_id: "21", describing_opinion_id: "99", group_id: "" },
      ]), { snapshot: "2026-09-30", held, dryRun: false, throttle });
      expect(await sql`SELECT id::int, text, cited_case_id FROM courtlistener_parenthetical ORDER BY id`)
        .toEqual([{ id: 501, text: "holding that X", cited_case_id: b }, { id: 502, text: "explaining Y", cited_case_id: null }]);

      // Cluster pass: opinion 77 belongs to cluster 2001, which Jurvio holds (no CL document); 88 stays unresolved.
      await fx.addClCluster(later, 2001);
      const needed = await loadUnmappedOpinionIds(sql);
      expect(Array.from(needed.ids)).toEqual([77, 88]);
      const clusterStats = await importOpinionClusterMap(sql, pairs([[11, 1001], [77, 2001], [88, 2002], [90, 2003]]),
        { snapshot: "2026-09-30", needed, dryRun: false, throttle });
      expect(clusterStats).toMatchObject({ rowsRead: 4, matched: 2, written: 2 });

      const finalized = await finalizeCitationMap(sql, { snapshot: "2026-09-30", throttle, dryRun: false });
      expect(finalized).toMatchObject({ movedToEdges: 1, parentheticalsMapped: 1 });
      expect(await sql`SELECT cited_opinion_id FROM courtlistener_citation_unresolved`).toEqual([{ cited_opinion_id: 88 }]);
      expect((await sql`SELECT cited_case_id FROM courtlistener_parenthetical WHERE id=502`)[0]).toEqual({ cited_case_id: later });
      const [build] = await sql<{ requested: boolean }[]>`SELECT sweep_requested_at IS NOT NULL AS requested FROM citation_edge_build`;
      expect(build?.requested).toBe(true);

      // The edge builder folds CL rows in; the sealed-caption case never shows.
      await runCitationEdgeJob(sql, { budgetMs: 30_000, pauseMs: 0 });
      const cited = await relatedCitationCases(sql, "jv-clmapcasea", "cited");
      expect(cited.map((row) => row.casePublicId).sort()).toEqual(["jv-clmapcaseb", "jv-clmaplater"]);
      const [edge] = await sql<{ depth: number; sources: number }[]>`SELECT depth, sources FROM case_citation_edge WHERE citing_document_id=${docA} AND cited_case_id=${b}`;
      expect(edge).toEqual({ depth: 3, sources: 2 });
    } finally {
      await fx.drop();
      await sql.end();
    }
  });
});
