import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { publishCaseOpinionDocuments } from "./publish-federal-opinion-documents";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("deterministic federal opinion document publication", () => {
  it("publishes eligible opinion documents, holds ineligible ones, and never double-publishes", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const schema = `fed_doc_pub_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
      for (const name of ["0001_foundation.sql", "0010_opinion_research.sql"]) {
        const source = await readFile(`db/migrations/${name}`, "utf8");
        await sql.unsafe(source.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
      }
      await sql`ALTER TABLE legal_case ADD COLUMN official_citation text, ADD COLUMN decided_on date`;
      await sql.unsafe(await readFile("db/migrations/0114_case_citation_graph.sql", "utf8"));
      await sql.unsafe(await readFile("db/migrations/0115_citation_reporter_refresh.sql", "utf8"));
      await sql.unsafe(await readFile("db/migrations/0119_citation_publication_hold_rule_version.sql", "utf8"));
      await sql`CREATE TABLE publication_review(object_id uuid,status text,reviewer_id uuid)`;

      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code='courtlistener'`;
      const [court] = await sql<{ id: string }[]>`INSERT INTO court(public_id,provider_id,provider_court_id,name,jurisdiction,verification) VALUES('jc-ca2test01',${provider!.id},'ca2','Second Circuit','f','verified') RETURNING id`;

      async function seedCaseWithOpinion(opts: { suffix: string; words: number; sourceUri: string; recordId: string }) {
        // Per-seed, pure-hex, 64-char hashes (raw_artifact has a unique (provider_id,
        // content_hash); the document provenance check requires 64-hex hashes).
        const artHash = opts.recordId.padStart(64, "a");
        const docHash = opts.recordId.padStart(64, "0");
        const [artifact] = await sql<{ id: string }[]>`INSERT INTO raw_artifact(provider_id,source_uri,content_hash,object_key,media_type,retrieved_at,source_record_id)
          VALUES(${provider!.id},${opts.sourceUri},${artHash},${"k" + opts.suffix},'application/json',now(),${opts.recordId}) RETURNING id`;
        const [kase] = await sql<{ id: string }[]>`INSERT INTO legal_case(public_id,court_id,docket_number,caption,publication,verification,source_artifact_id)
          VALUES(${"jv-" + opts.suffix},${court!.id},${"d-" + opts.suffix},'United States v. Example','published','verified',${artifact!.id}) RETURNING id`;
        const [cluster] = await sql<{ id: string }[]>`INSERT INTO opinion_cluster(public_id,case_id,provider_id,provider_cluster_id,case_name,source_artifact_id)
          VALUES(${"jo-" + opts.suffix},${kase!.id},${provider!.id},${"cl-" + opts.suffix},'United States v. Example',${artifact!.id}) RETURNING id`;
        const [doc] = await sql<{ id: string }[]>`INSERT INTO document(public_id,case_id,document_type,title,publication,content_hash)
          VALUES(${"jd-" + opts.suffix},${kase!.id},'judicial_opinion','Opinion','draft',${docHash}) RETURNING id`;
        await sql`INSERT INTO judicial_opinion(cluster_id,document_id,provider_id,provider_opinion_id,opinion_type,source_artifact_id)
          VALUES(${cluster!.id},${doc!.id},${provider!.id},${opts.recordId},'majority',${artifact!.id})`;
        await sql`INSERT INTO document_content(document_id,content_html,content_text,content_hash,extraction_method,word_count,source_artifact_id)
          VALUES(${doc!.id},'<p>opinion</p>',${"word ".repeat(opts.words)},${docHash},'fixture',${opts.words},${artifact!.id})`;
        return { caseId: kase!.id, documentId: doc!.id };
      }

      // Eligible opinion: REST-sourced, 200 words, linked cluster.
      const good = await seedCaseWithOpinion({
        suffix: "good0001", words: 200,
        sourceUri: "https://www.courtlistener.com/api/rest/v4/opinions/2/", recordId: "2",
      });
      expect(await publishCaseOpinionDocuments(sql, good.caseId)).toMatchObject({ published: 1, held: 0 });
      expect((await sql`SELECT publication FROM document WHERE id=${good.documentId}`)[0]?.publication).toBe("published");
      expect(await sql`SELECT 1 FROM publication_decision WHERE object_type='document' AND object_id=${good.documentId} AND displayable`).toHaveLength(1);
      const outboxAfterFirst = await sql`SELECT 1 FROM outbox_event WHERE aggregate_type='document' AND aggregate_id=${good.documentId}`;
      expect(outboxAfterFirst).toHaveLength(1);

      // Idempotent: the document is now published, so a second run publishes nothing and
      // emits no further publication event (no double publish).
      expect(await publishCaseOpinionDocuments(sql, good.caseId)).toMatchObject({ published: 0, held: 0 });
      expect(await sql`SELECT 1 FROM outbox_event WHERE aggregate_type='document' AND aggregate_id=${good.documentId}`).toHaveLength(1);

      // Thin opinion: held (thin_opinion), not published.
      const thin = await seedCaseWithOpinion({
        suffix: "thin0001", words: 12,
        sourceUri: "https://www.courtlistener.com/api/rest/v4/opinions/3/", recordId: "3",
      });
      const thinResult = await publishCaseOpinionDocuments(sql, thin.caseId);
      expect(thinResult.published).toBe(0);
      expect(thinResult.held).toBe(1);
      expect(thinResult.holdReasons.thin_opinion).toBe(1);
      expect((await sql`SELECT publication FROM document WHERE id=${thin.documentId}`)[0]?.publication).toBe("draft");
      expect((await sql`SELECT reasons FROM citation_publication_hold WHERE document_id=${thin.documentId}`)[0]?.reasons)
        .toContain("thin_opinion");

      // Unverified source: a non-CourtListener, non-REST/bulk URL is held.
      const badSource = await seedCaseWithOpinion({
        suffix: "badsrc01", words: 200,
        sourceUri: "https://example.com/opinion", recordId: "4",
      });
      const badResult = await publishCaseOpinionDocuments(sql, badSource.caseId);
      expect(badResult.held).toBe(1);
      expect(badResult.holdReasons.unverified_opinion_source).toBe(1);
      expect((await sql`SELECT publication FROM document WHERE id=${badSource.documentId}`)[0]?.publication).toBe("draft");

      // Budget cap (bounded pilot): a case with two eligible opinion documents, called with
      // maxPublish:1, publishes exactly one and leaves the other draft so a combined ceiling
      // is honored exactly. A follow-up call with remaining budget publishes the rest.
      const twoDoc = await seedCaseWithOpinion({
        suffix: "budget01", words: 200,
        sourceUri: "https://www.courtlistener.com/api/rest/v4/opinions/5/", recordId: "5",
      });
      const art2Hash = "6".padStart(64, "a");
      const doc2Hash = "6".padStart(64, "0");
      const [art2] = await sql<{ id: string }[]>`INSERT INTO raw_artifact(provider_id,source_uri,content_hash,object_key,media_type,retrieved_at,source_record_id)
        VALUES(${provider!.id},'https://www.courtlistener.com/api/rest/v4/opinions/6/',${art2Hash},'kbudget02','application/json',now(),'6') RETURNING id`;
      const [cluster2] = await sql<{ id: string }[]>`INSERT INTO opinion_cluster(public_id,case_id,provider_id,provider_cluster_id,case_name,source_artifact_id)
        VALUES('jo-budget02',${twoDoc.caseId},${provider!.id},'cl-budget02','United States v. Example',${art2!.id}) RETURNING id`;
      const [doc2] = await sql<{ id: string }[]>`INSERT INTO document(public_id,case_id,document_type,title,publication,content_hash)
        VALUES('jd-budget02',${twoDoc.caseId},'judicial_opinion','Concurrence','draft',${doc2Hash}) RETURNING id`;
      await sql`INSERT INTO judicial_opinion(cluster_id,document_id,provider_id,provider_opinion_id,opinion_type,source_artifact_id)
        VALUES(${cluster2!.id},${doc2!.id},${provider!.id},'6','concurrence',${art2!.id})`;
      await sql`INSERT INTO document_content(document_id,content_html,content_text,content_hash,extraction_method,word_count,source_artifact_id)
        VALUES(${doc2!.id},'<p>opinion</p>',${"word ".repeat(200)},${doc2Hash},'fixture',200,${art2!.id})`;

      const capped = await publishCaseOpinionDocuments(sql, twoDoc.caseId, { maxPublish: 1 });
      expect(capped).toMatchObject({ published: 1, held: 0 });
      const states = (await sql<{ publication: string }[]>`SELECT publication FROM document WHERE case_id=${twoDoc.caseId} AND document_type='judicial_opinion'`).map((r) => r.publication);
      expect(states.filter((p) => p === "published")).toHaveLength(1);
      expect(states.filter((p) => p === "draft")).toHaveLength(1);

      const rest = await publishCaseOpinionDocuments(sql, twoDoc.caseId, { maxPublish: 5 });
      expect(rest.published).toBe(1);
      expect((await sql<{ c: number }[]>`SELECT count(*)::int c FROM document WHERE case_id=${twoDoc.caseId} AND document_type='judicial_opinion' AND publication='draft'`)[0]?.c).toBe(0);
    } finally {
      await sql.unsafe(`SET search_path TO public; DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await sql.end();
    }
  }, 30000);
});
