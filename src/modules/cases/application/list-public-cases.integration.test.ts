import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { containsPattern, listPublicCases } from "./list-public-cases";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}

type Sql = Parameters<typeof listPublicCases>[0];

// Runs against a fully migrated database (as in CI) inside a transaction that is
// always rolled back, so no fixture rows survive the test.
describe.skipIf(!databaseUrl)("public case listing database integration", () => {
  it("filters, ranks and enriches only publicly displayable records", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        const decide = (type: string, id: string, displayable = true) => tx`
          INSERT INTO publication_decision(object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES (${type}, ${id}, ${displayable}, true, true, false, false, 'fixture', 'v1')`;
        const [provider] = await tx<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
        const [artifact] = await tx<{ id: string }[]>`
          INSERT INTO raw_artifact(provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
          VALUES (${provider!.id}, 'https://example.test/fixture', ${"b".repeat(64)}, 'listing-fixture', 'application/json', now()) RETURNING id`;
        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court(public_id, name, verification) VALUES ('jc-listfix1', 'Listing Fixture Court', 'verified') RETURNING id`;

        async function addCase(input: {
          publicId: string; caption: string; docket: string; filedOn: string; decidedOn?: string | null;
          citation?: string | null; verification?: string; displayable?: boolean;
        }) {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case(public_id, court_id, docket_number, caption, filed_on, decided_on, official_citation, publication, verification)
            VALUES (${input.publicId}, ${court!.id}, ${input.docket}, ${input.caption}, ${input.filedOn}, ${input.decidedOn ?? null},
              ${input.citation ?? null}, 'published', ${input.verification ?? "not_verified"})
            RETURNING id`;
          await decide("legal_case", row!.id, input.displayable ?? true);
          return row!.id;
        }
        async function addParty(caseId: string, publicId: string, name: string, type: string, displayable = true) {
          const [entity] = await tx<{ id: string }[]>`
            INSERT INTO entity(public_id, entity_type, display_name, normalized_name)
            VALUES (${publicId}, ${type}, ${name}, ${name.toLowerCase()}) RETURNING id`;
          if (!displayable) await decide("entity", entity!.id, false);
          await tx`INSERT INTO party_appearance(case_id, entity_id, role, party_name_as_filed) VALUES (${caseId}, ${entity!.id}, 'party', ${name})`;
        }

        const decided = await addCase({
          publicId: "jv-listfix01", caption: "Zebra Holdings v. Fixture Agency", docket: "22-451",
          filedOn: "2023-01-10", decidedOn: "2024-06-28", citation: "603 U.S. 369 (2024)", verification: "verified",
        });
        const active = await addCase({ publicId: "jv-listfix02", caption: "Alpha Fixture Corp. v. Beta LLC", docket: "1:20-cv-03010", filedOn: "2020-10-20" });
        await addCase({ publicId: "jv-listfix03", caption: "Hidden Fixture v. Secret", docket: "9:99-cv-00001", filedOn: "2025-01-01", displayable: false });

        await addParty(decided, "je-listfix01", "Fixture Agency", "agency");
        await addParty(active, "je-listfix02", "Beta LLC", "organization");
        await addParty(active, "je-listfix03", "Fixture Counsel LLP", "law_firm");
        await addParty(active, "je-listfix04", "Concealed Fixture Firm", "law_firm", false);

        // Docket entries: the newest public one wins; a hidden later entry is ignored.
        const [entry] = await tx<{ id: string }[]>`
          INSERT INTO docket_entry(public_id, provider_entry_id, case_id, filed_on, description) VALUES ('jde-listfix1', 'listfix-1', ${active}, '2025-09-02', 'MEMORANDUM OPINION') RETURNING id`;
        await decide("docket_entry", entry!.id);
        const [hiddenEntry] = await tx<{ id: string }[]>`
          INSERT INTO docket_entry(public_id, provider_entry_id, case_id, filed_on, description) VALUES ('jde-listfix2', 'listfix-2', ${active}, '2026-01-05', 'SEALED ENTRY') RETURNING id`;
        await decide("docket_entry", hiddenEntry!.id, false);

        // A readable, published majority opinion with an author.
        const [document] = await tx<{ id: string }[]>`
          INSERT INTO document(public_id, case_id, document_type, title, publication, content_hash)
          VALUES ('jd-listfix1', ${decided}, 'judicial_opinion', 'Opinion of the Court', 'published', 'fixture') RETURNING id`;
        await decide("document", document!.id);
        await tx`INSERT INTO document_content(document_id, content_html, content_text, content_hash, extraction_method, word_count, source_artifact_id)
          VALUES (${document!.id}, '<p>Opinion</p>', 'Opinion', 'fixture', 'fixture', 1, ${artifact!.id})`;
        const [cluster] = await tx<{ id: string }[]>`
          INSERT INTO opinion_cluster(public_id, provider_id, provider_cluster_id, case_id, case_name, source_artifact_id)
          VALUES ('joc-listfix1', ${provider!.id}, 'listfix-cluster', ${decided}, 'Zebra Holdings v. Fixture Agency', ${artifact!.id}) RETURNING id`;
        await tx`INSERT INTO judicial_opinion(cluster_id, document_id, provider_id, provider_opinion_id, opinion_type, author_name, source_artifact_id)
          VALUES (${cluster!.id}, ${document!.id}, ${provider!.id}, 'listfix-opinion', 'majority', 'Roberts', ${artifact!.id})`;

        const list = (options: Partial<Parameters<typeof listPublicCases>[1]>) =>
          listPublicCases(sql, { page: 1, pageSize: 50, court: "jc-listfix1", ...options });

        const browse = await list({});
        expect(browse.cases.map((row) => row.publicId)).toEqual(["jv-listfix01", "jv-listfix02"]);
        expect(browse.total).toBe(2);

        const [first, second] = browse.cases;
        expect(first).toMatchObject({ verification: "verified", opinionAuthor: "Roberts", hasPublicDocument: true, decidedOn: "2024-06-28" });
        expect(second).toMatchObject({ latestEntryOn: "2025-09-02", latestEntryDescription: "MEMORANDUM OPINION", opinionAuthor: null });

        expect((await list({ sort: "az" })).cases.map((row) => row.publicId)).toEqual(["jv-listfix02", "jv-listfix01"]);
        expect((await list({ sort: "oldest" })).cases.map((row) => row.publicId)).toEqual(["jv-listfix02", "jv-listfix01"]);

        expect((await list({ query: "603 U.S. 369" })).cases.map((row) => row.publicId)).toEqual(["jv-listfix01"]);
        expect((await list({ query: "Fixture", sort: "best" })).total).toBe(2);
        expect((await list({ query: "Secret" })).total).toBe(0);
        await tx`INSERT INTO scotus_case_enrichment(case_id, official_docket_url, parser_version, verification, exact_holding, holding_source_url, holding_source_locator)
          VALUES (${decided}, 'https://www.supremecourt.gov/docket/docketfiles/html/public/22-451.html', 'fixture', 'verified',
            'Courts must exercise independent judgment.', 'https://www.supremecourt.gov/', 'syllabus')`;
        expect((await list({ query: "independent judgment" })).cases.map((row) => row.publicId)).toEqual(["jv-listfix01"]);
        expect((await list({})).cases[0]?.holding).toBe("Courts must exercise independent judgment.");
        expect((await list({ query: "100%" })).total).toBe(0);

        expect((await list({ party: "beta" })).cases.map((row) => row.publicId)).toEqual(["jv-listfix02"]);
        expect((await list({ party: "Fixture Counsel" })).total).toBe(0);
        expect((await list({ firm: "Fixture Counsel" })).cases.map((row) => row.publicId)).toEqual(["jv-listfix02"]);
        expect((await list({ firm: "Concealed" })).total).toBe(0);

        expect((await list({ decided: true })).cases.map((row) => row.publicId)).toEqual(["jv-listfix01"]);
        expect((await list({ opinion: true })).cases.map((row) => row.publicId)).toEqual(["jv-listfix01"]);
        expect((await list({ verified: true })).cases.map((row) => row.publicId)).toEqual(["jv-listfix01"]);
        expect((await list({ fromYear: 2021, toYear: 2024 })).cases.map((row) => row.publicId)).toEqual(["jv-listfix01"]);
        expect((await list({ toYear: 2020 })).cases.map((row) => row.publicId)).toEqual(["jv-listfix02"]);

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await client.end();
    }
  });

  it("escapes LIKE wildcards in user text", () => {
    expect(containsPattern("100%_\\")).toBe("%100\\%\\_\\\\%");
  });
});
