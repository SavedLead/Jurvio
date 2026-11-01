import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { getPublicCase } from "./get-public-case";
import { listPublicCases } from "./list-public-cases";

const databaseUrl = process.env.DATABASE_URL;

// The /cases "Readable opinion" badge and the case page's opinion-pending
// banner must agree (audit: Miranda showed "Readable opinion" in search but
// "Opinion text is pending" on its page).
describe.skipIf(!databaseUrl)("readable opinion is one rule for search and case pages", () => {
  const root = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  let sql = root;
  let courtId = "";
  afterAll(async () => { if (databaseUrl) await root.end(); });

  async function caseWith(suffix: string, document: { text: string | null; displayable: boolean } | null) {
    const publicId = `jv-ro${tag}${suffix}`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
      VALUES (${publicId}, ${courtId}, ${`1:26-cv-${suffix}`}, ${`Readable ${tag} v. ${suffix}`}, 'published', 'verified') RETURNING id`;
    await sql`
      INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
      VALUES ('legal_case', ${row!.id}, true, true, true, false, false, 'test', 'test')`;
    if (document) {
      const [doc] = await sql<{ id: string }[]>`
        INSERT INTO document (public_id, case_id, document_type, title, publication)
        VALUES (${`jdoc-ro${tag}${suffix}`}, ${row!.id}, 'judicial opinion', 'Opinion', 'published') RETURNING id`;
      await sql`
        INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
        VALUES ('document', ${doc!.id}, ${document.displayable}, true, true, false, false, 'test', 'test')`;
      if (document.text !== null) {
        const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider ORDER BY code LIMIT 1`;
        const [artifact] = await sql<{ id: string }[]>`
          INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
          VALUES (${provider!.id}, ${`https://example.test/${publicId}`}, ${randomBytes(32).toString("hex")}, ${`test/${publicId}.html`}, 'text/html', now()) RETURNING id`;
        await sql`
          INSERT INTO document_content (document_id, content_html, content_text, content_hash, extraction_method, word_count, source_artifact_id)
          VALUES (${doc!.id}, ${document.text}, ${document.text}, ${randomBytes(32).toString("hex")}, 'test', ${document.text.trim() ? document.text.trim().split(/\s+/).length : 0}, ${artifact!.id})`;
      }
    }
    return publicId;
  }

  // Runs in a transaction that is rolled back, so concurrent tests (e.g. the
  // public_case_search sweep test) never see these published cases.
  it("agrees for text, a PDF-only document, blank text and a hidden document", async () => {
    const rollback = new Error("rollback");
    await root.begin(async (tx) => {
      sql = tx as unknown as typeof root;
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-ro${tag}`}, ${`ro${tag}`}, ${`Readable Test Court ${tag}`}, 'FD', 'verified') RETURNING id`;
      courtId = court!.id;
      const expected: Record<string, boolean> = {
        [await caseWith("text", { text: "The judgment is affirmed.", displayable: true })]: true,
        [await caseWith("pdfonly", { text: null, displayable: true })]: false,
        [await caseWith("blank", { text: "   \n ", displayable: true })]: false,
        [await caseWith("hidden", { text: "Hidden opinion text.", displayable: false })]: false,
        [await caseWith("none", null)]: false,
      };
      const listing = await listPublicCases(sql, { page: 1, pageSize: 20, court: `jc-ro${tag}`, sort: "az" });
      const badge = Object.fromEntries(listing.cases.map((item) => [item.publicId, item.hasPublicDocument]));
      const filtered = await listPublicCases(sql, { page: 1, pageSize: 20, court: `jc-ro${tag}`, sort: "az", opinion: true });
      for (const [publicId, readable] of Object.entries(expected)) {
        const page = await getPublicCase(sql, publicId);
        expect(page!.hasReadableOpinion, publicId).toBe(readable);
        expect(badge[publicId], publicId).toBe(readable);
        expect(filtered.cases.some((item) => item.publicId === publicId), publicId).toBe(readable);
      }
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  });
});
