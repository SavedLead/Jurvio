import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { getPublicOpinion } from "./get-public-opinion";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("opinion page without extracted text", () => {
  const root = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  afterAll(async () => { if (databaseUrl) await root.end(); });

  it("returns a published opinion that has an official PDF and no document_content row", async () => {
    const rollback = new Error("rollback");
    const tag = randomUUID().replaceAll("-", "").slice(0, 8);
    await root.begin(async (tx) => {
      const sql = tx as unknown as typeof root;
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider ORDER BY code LIMIT 1`;
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-op${tag}`}, ${`op${tag}`}, 'Supreme Court of the United States', 'F', 'verified') RETURNING id`;
      const casePublicId = `jv-op${tag}`;
      const documentPublicId = `jd-op${tag}`;
      const [legalCase] = await sql<{ id: string }[]>`
        INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
        VALUES (${casePublicId}, ${court!.id}, ${`26A${tag.slice(0, 3)}`}, ${`Pdf Only ${tag} v. Reader`}, 'published', 'verified') RETURNING id`;
      await sql`
        INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
        VALUES ('legal_case', ${legalCase!.id}, true, true, true, false, false, 'test', 'test')`;
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
        VALUES (${provider!.id}, ${`https://www.supremecourt.gov/opinions/26pdf/${tag}.pdf`}, ${randomBytes(32).toString("hex")}, ${`test/${tag}.pdf`}, 'application/pdf', now()) RETURNING id`;
      const [document] = await sql<{ id: string }[]>`
        INSERT INTO document (public_id, case_id, document_type, title, publication)
        VALUES (${documentPublicId}, ${legalCase!.id}, 'judicial_opinion', 'Opinion', 'published') RETURNING id`;
      await sql`
        INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
        VALUES ('document', ${document!.id}, true, true, true, false, false, 'test', 'test')`;
      const [cluster] = await sql<{ id: string }[]>`
        INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, date_filed, precedential_status, source_artifact_id)
        VALUES (${`jo-op${tag}`}, ${legalCase!.id}, ${provider!.id}, ${`cluster-${tag}`}, ${`Pdf Only ${tag}`}, '2026-11-09', 'Published', ${artifact!.id}) RETURNING id`;
      await sql`
        INSERT INTO judicial_opinion (cluster_id, document_id, provider_id, provider_opinion_id, opinion_type, per_curiam, source_download_url, source_artifact_id)
        VALUES (${cluster!.id}, ${document!.id}, ${provider!.id}, ${`opinion-${tag}`}, 'per-curiam', true, ${`https://www.supremecourt.gov/opinions/26pdf/${tag}.pdf`}, ${artifact!.id})`;

      const opinion = await getPublicOpinion(sql, casePublicId, documentPublicId);
      expect(opinion?.casePublicId).toBe(casePublicId);
      expect(opinion?.wordCount).toBe(0);
      expect(opinion?.contentText).toBe("");
      expect(opinion?.sourceDownloadUrl).toMatch(/\.pdf$/);
      expect(opinion?.indexable).toBe(false);
      expect(await getPublicOpinion(sql, casePublicId, "jd-missing1")).toBeNull();
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  });
});
