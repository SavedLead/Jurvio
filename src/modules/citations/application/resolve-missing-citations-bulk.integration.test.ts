import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import type { BulkCsvSource } from "@/modules/ingestion/providers/courtlistener/bulk";
import {
  bulkCitationKey,
  markIngestedResolvedCitations,
  resolveMissingCitationsFromBulk,
  resolvedClusterIds,
} from "./resolve-missing-citations-bulk";

function csvSource(rows: string[][]): BulkCsvSource {
  const body = [["id", "cluster_id", "volume", "reporter", "page", "type"], ...rows].map(row => row.join(",")).join("\n") + "\n";
  return { stream: Readable.from([body]), close: () => undefined, completion: Promise.resolve() };
}

describe("bulk citation key", () => {
  it("matches the text parser and rejects junk rows", () => {
    expect(bulkCitationKey({ volume: "347", reporter: "U.S.", page: "483" })).toBe("347us483");
    expect(bulkCitationKey({ volume: "", reporter: "U.S.", page: "483" })).toBeNull();
    expect(bulkCitationKey({ volume: "347", reporter: "U.S.", page: "___" })).toBeNull();
  });
});

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("bulk citation resolution database integration", () => {
  it("links local cases, resolves exact clusters, refuses ambiguity and backs off absent citations", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const schema = `citation_bulk_test_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
      for (const name of ["0001_foundation.sql", "0002_artifact_provenance.sql", "0010_opinion_research.sql"]) {
        const source = await readFile(`db/migrations/${name}`, "utf8");
        await sql.unsafe(source.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      }
      await sql`ALTER TABLE legal_case ADD COLUMN official_citation text, ADD COLUMN decided_on date`;
      for (const name of ["0114_case_citation_graph.sql", "0115_citation_reporter_refresh.sql", "0122_missing_citation_bulk_resolution.sql"]) {
        await sql.unsafe(await readFile(`db/migrations/${name}`, "utf8"));
      }
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code='courtlistener'`;
      const [artifact] = await sql<{ id: string }[]>`INSERT INTO raw_artifact(provider_id,source_uri,content_hash,object_key,media_type,retrieved_at) VALUES(${provider!.id},'https://example.test/fixture',${"a".repeat(64)},'fixture','application/json',now()) RETURNING id`;
      const [court] = await sql<{ id: string }[]>`INSERT INTO court(public_id,name,verification) VALUES('jc-bulk1234','Test Court','verified') RETURNING id`;
      const [held] = await sql<{ id: string }[]>`INSERT INTO legal_case(public_id,court_id,docket_number,caption,publication,verification) VALUES('jv-held1234',${court!.id},'1','Held v. Local','published','verified') RETURNING id`;
      await sql`INSERT INTO opinion_cluster(public_id,case_id,provider_id,provider_cluster_id,case_name,citations,source_artifact_id) VALUES('jo-bulk1234',${held!.id},${provider!.id},'123','Held v. Local','[]'::jsonb,${artifact!.id})`;
      await sql`DELETE FROM case_citation_work`;
      await sql`INSERT INTO missing_case_citation(citation_key,citation_label) VALUES
        ('100ny2d1','100 N.Y.2d 1'),('123f3d456','123 F.3d 456'),('55f2d77','55 F.2d 77'),('9f3d9','9 F.3d 9'),('cl-cluster:5','CourtListener opinion cluster 5')`;
      await sql`INSERT INTO missing_case_citation(citation_key,citation_label,state) VALUES('77f3d7','77 F.3d 7','held')`;

      const result = await resolveMissingCitationsFromBulk(sql, {
        snapshotDate: "2026-09-30",
        sourceUri: "https://example.test/citations-2026-09-30.csv.bz2",
        openCitations: () => csvSource([
          ["1", "123", "100", "N.Y.2d", "1"],
          ["2", "900", "123", "F.3d", "456"],
          ["3", "11", "55", "F.2d", "77"],
          ["4", "12", "55", "F.2d", "77"],
          ["5", "13", "77", "F.3d", "7"],
          ["6", "14", "1", "U.S.", "1"],
        ]),
      });
      expect(result).toEqual({ missing: 4, scannedRows: 6, linkedLocal: 1, resolved: 1, ambiguous: 1, notInSnapshot: 1 });

      const states = Object.fromEntries((await sql<{ citation_key: string; state: string; resolved_cluster_id: string | null }[]>`
        SELECT citation_key, state, resolved_cluster_id::text FROM missing_case_citation`).map(row => [row.citation_key, [row.state, row.resolved_cluster_id]]));
      expect(states).toEqual({
        "100ny2d1": ["pending", "123"],
        "123f3d456": ["resolved", "900"],
        "55f2d77": ["ambiguous", null],
        "9f3d9": ["not_found", null],
        "cl-cluster:5": ["pending", null],
        "77f3d7": ["held", null],
      });
      // The locally held case gains a source-backed alias and a prioritized refresh.
      expect(await sql`SELECT case_id, citation_key FROM case_citation_verified_alias`).toEqual([{ case_id: held!.id, citation_key: "100ny2d1" }]);
      expect((await sql`SELECT case_id FROM case_citation_work`).map(row => row.case_id)).toEqual([held!.id]);
      // Absent citations wait longer before API discovery retries them.
      const [absent] = await sql<{ later: boolean }[]>`SELECT next_attempt_at > now()+interval '2 days' AS later FROM missing_case_citation WHERE citation_key='9f3d9'`;
      expect(absent?.later).toBe(true);

      expect(await resolvedClusterIds(sql, 10)).toEqual(["900"]);
      expect(await markIngestedResolvedCitations(sql)).toBe(0);
      const [cited] = await sql<{ id: string }[]>`INSERT INTO legal_case(public_id,court_id,docket_number,caption,publication,verification) VALUES('jv-cited123',${court!.id},'2','Cited v. Case','draft','not_verified') RETURNING id`;
      await sql`INSERT INTO opinion_cluster(public_id,case_id,provider_id,provider_cluster_id,case_name,citations,source_artifact_id) VALUES('jo-cited123',${cited!.id},${provider!.id},'900','Cited v. Case','[]'::jsonb,${artifact!.id})`;
      expect(await markIngestedResolvedCitations(sql)).toBe(1);
      expect(await resolvedClusterIds(sql, 10)).toEqual([]);

      // Re-running against the same snapshot is idempotent for settled rows.
      const again = await resolveMissingCitationsFromBulk(sql, {
        snapshotDate: "2026-09-30",
        sourceUri: "https://example.test/citations-2026-09-30.csv.bz2",
        openCitations: () => csvSource([["1", "123", "100", "N.Y.2d", "1"]]),
      });
      expect(again.resolved).toBe(0);
    } finally {
      await sql.unsafe(`SET search_path TO public; DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await sql.end();
    }
  }, 30000);
});
