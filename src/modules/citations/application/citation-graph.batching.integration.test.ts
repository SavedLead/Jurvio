import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { chunkRows, syncCitationGraph } from "./sync-citation-graph";
import { identityCitations } from "../domain/citations";

// The case-citation-graph lane failed with MAX_PARAMETERS_EXCEEDED: postgres.js
// allows at most 65,534 bind parameters per statement. These rows would need
// 75,000 (identities) and 72,000 (document citations) as VALUES lists.

describe("chunkRows", () => {
  it("splits into bounded chunks and rejects bad sizes", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 2)).toEqual([]);
    expect(() => chunkRows([1], 0)).toThrow();
  });
});

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("citation graph batching (database)", () => {
  it("syncs more rows than one statement's parameter limit", { timeout: 120_000 }, async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const schema = `citation_batch_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
      for (const name of ["0001_foundation.sql", "0010_opinion_research.sql"]) {
        const source = await readFile(`db/migrations/${name}`, "utf8");
        await sql.unsafe(source.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      }
      await sql`ALTER TABLE legal_case ADD COLUMN official_citation text, ADD COLUMN decided_on date`;
      for (const name of [
        "0114_case_citation_graph.sql",
        "0115_citation_reporter_refresh.sql",
        "0119_citation_publication_hold_rule_version.sql",
        "0122_missing_citation_bulk_resolution.sql",
      ]) {
        await sql.unsafe(await readFile(`db/migrations/${name}`, "utf8"));
      }
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code='courtlistener'`;
      const [artifact] = await sql<{ id: string }[]>`INSERT INTO raw_artifact(provider_id,source_uri,content_hash,object_key,media_type,retrieved_at) VALUES(${provider!.id},'https://www.courtlistener.com/api/rest/v4/opinions/9/',${"b".repeat(64)},'fixture','application/json',now()) RETURNING id`;
      const [court] = await sql<{ id: string }[]>`INSERT INTO court(public_id,name,verification) VALUES('jc-batch123','Batch Court','verified') RETURNING id`;
      const [legalCase] = await sql<{ id: string }[]>`INSERT INTO legal_case(public_id,court_id,docket_number,caption,publication,verification) VALUES('jv-batch123',${court!.id},'1','Many v. Citations','published','verified') RETURNING id`;

      const citations = Array.from({ length: 25_000 }, (_, i) => ({
        volume: (i % 500) + 1,
        reporter: "S. Ct.",
        page: String(Math.floor(i / 500) + 1),
      }));
      const identityCount = identityCitations(citations).length;
      // 3 parameters per row as a VALUES list would exceed 65,534.
      expect(identityCount * 3).toBeGreaterThan(65_534);
      await sql`INSERT INTO opinion_cluster(public_id,case_id,provider_id,provider_cluster_id,case_name,citations,source_artifact_id) VALUES('jo-batch123',${legalCase!.id},${provider!.id},'777','Many v. Citations',${sql.json(citations)},${artifact!.id})`;

      const text = Array.from({ length: 8_000 }, (_, i) => `See ${(i % 400) + 1} U.S. ${Math.floor(i / 400) + 1}.`).join(" ");
      const documentCitations = 8_000;
      const [document] = await sql<{ id: string }[]>`INSERT INTO document(public_id,case_id,document_type,title,publication,content_hash) VALUES('jd-batch123',${legalCase!.id},'judicial_opinion','Long opinion','published','h1') RETURNING id`;
      await sql`INSERT INTO document_content(document_id,content_html,content_text,content_hash,extraction_method,word_count,source_artifact_id) VALUES(${document!.id},'<p></p>',${text},'h1','fixture',1,${artifact!.id})`;

      await syncCitationGraph(sql, 200);
      const [identities] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM case_citation_identity WHERE case_id=${legalCase!.id}`;
      // Every reporter citation plus the cl-cluster key.
      expect(identities!.n).toBe(identityCount + 1);
      const [edges] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM document_case_citation WHERE document_id=${document!.id}`;
      expect(edges!.n).toBe(documentCitations);
      const [work] = await sql<{ n: number }[]>`SELECT (SELECT count(*) FROM case_citation_work) + (SELECT count(*) FROM document_citation_work) AS n`;
      expect(Number(work!.n)).toBe(0);

      // A re-sync replaces rather than duplicates.
      await sql`INSERT INTO case_citation_work(case_id) VALUES(${legalCase!.id}) ON CONFLICT DO NOTHING`;
      await syncCitationGraph(sql, 200);
      const [again] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM case_citation_identity WHERE case_id=${legalCase!.id}`;
      expect(again!.n).toBe(identityCount + 1);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await sql.end();
    }
  });
});
