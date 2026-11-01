import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { citedStubsForCase, loadCitationStub, parseStubParam, refreshCitationStubs, stubCitingCases, stubPath } from "./citation-stubs";
import { CITATION_WEB_MIGRATIONS, citationTestSchema } from "./test-migrations";

const url = process.env.DATABASE_URL;

describe("cited-case stub helpers", () => {
  it("round-trips stub paths", () => {
    expect(stubPath(123)).toBe("/cited/cl-123");
    expect(parseStubParam("cl-123")).toBe(123);
    expect(parseStubParam("cl-0123")).toBeNull();
    expect(parseStubParam("123")).toBeNull();
  });
});

describe.skipIf(!url)("cited-case stubs (database)", () => {
  it("builds stubs only for safe resolved clusters, links them both ways, and retires them once the case is held", { timeout: 60_000 }, async () => {
    const sql = postgres(url!, { max: 1, onnotice: () => undefined });
    const fx = await citationTestSchema(sql, "clstub", [...CITATION_WEB_MIGRATIONS, "0133_courtlistener_cluster_stage.sql", "0175_citation_stub_case.sql"]);
    try {
      const citing = await fx.addCase("jv-stubcitinga", null, "Alpha v. Beta");
      const hidden = await fx.addCase("jv-stubhiddenb", null, "Gamma v. Delta", { displayable: false });
      const doc = await fx.addOpinion(citing, "See Foo v. Bar, 100 F.3d 1; Sealed v. Doe, 200 F.3d 2; Res v. Tricted, 300 F.3d 3.");
      const hiddenDoc = await fx.addOpinion(hidden, "See Foo v. Bar, 100 F.3d 1.");
      for (const [documentId, key, start] of [[doc, "100 F.3d 1", 4], [doc, "200 F.3d 2", 30], [doc, "300 F.3d 3", 60], [hiddenDoc, "100 F.3d 1", 4]] as const) {
        await sql`INSERT INTO document_case_citation (document_id, citation_key, citation_label, source_content_hash, source_artifact_id, location_kind, start_offset, end_offset, parser_version)
          VALUES (${documentId}, ${key}, ${key}, 'h', ${fx.artifactId}, 'text', ${start}, ${start + 10}, 'v1')`;
      }
      await sql`INSERT INTO missing_case_citation (citation_key, citation_label, state, resolved_cluster_id) VALUES
        ('100 F.3d 1', '100 F.3d 1', 'resolved', 9001), ('200 F.3d 2', '200 F.3d 2', 'resolved', 9002), ('300 F.3d 3', '300 F.3d 3', 'resolved', 9003)`;
      await sql`INSERT INTO courtlistener_pending_cluster (cluster_id, docket_id, snapshot_date, case_name, date_filed, restricted, public_id, provider_metadata) VALUES
        ('9001', 'd1', '2026-09-30', 'Foo v. Bar', '1999-05-01', false, 'jo-p9001', '{}'),
        ('9002', 'd2', '2026-09-30', 'In re Sealed Case', '1999-05-02', false, 'jo-p9002', '{}'),
        ('9003', 'd3', '2026-09-30', 'Res v. Tricted', '1999-05-03', true, 'jo-p9003', '{}')`;

      const first = await refreshCitationStubs(sql, { batch: 2, deadline: Date.now() + 30_000 });
      expect(first).toMatchObject({ upserted: 1, completed: true });
      expect(await sql`SELECT cluster_id::int, case_name, citation_labels FROM citation_stub_case`)
        .toEqual([{ cluster_id: 9001, case_name: "Foo v. Bar", citation_labels: ["100 F.3d 1"] }]);
      expect(await citedStubsForCase(sql, "jv-stubcitinga")).toEqual([{ clusterId: 9001, caseName: "Foo v. Bar", citationLabel: "100 F.3d 1", dateFiled: "1999-05-01" }]);
      expect(await citedStubsForCase(sql, "jv-stubhiddenb")).toEqual([]);
      expect((await stubCitingCases(sql, 9001)).map((row) => row.casePublicId)).toEqual(["jv-stubcitinga"]);
      expect(await loadCitationStub(sql, 9002)).toBeNull();
      expect((await loadCitationStub(sql, 9001))?.caseName).toBe("Foo v. Bar");

      // Jurvio imports the case: the stub redirects, and the next pass removes it.
      const real = await fx.addCase("jv-stubrealcas", "100 F.3d 1", "Foo v. Bar");
      await fx.addClCluster(real, 9001);
      expect((await loadCitationStub(sql, 9001))?.heldCasePublicId).toBe("jv-stubrealcas");
      const second = await refreshCitationStubs(sql, { batch: 2, deadline: Date.now() + 30_000 });
      expect(second.removed).toBe(1);
      expect(await sql`SELECT 1 FROM citation_stub_case`).toHaveLength(0);
    } finally {
      await fx.drop();
      await sql.end();
    }
  });
});
