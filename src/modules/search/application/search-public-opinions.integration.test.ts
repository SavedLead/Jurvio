import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  isStatementTimeout,
  listOpinionSearchFacets,
  normalizeOpinionSearchFilters,
  searchPublicOpinions,
  withStatementTimeout,
} from "./search-public-opinions";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}
type Sql = Parameters<typeof searchPublicOpinions>[0];

describe.skipIf(!databaseUrl)("public opinion search", () => {
  it("returns only visible opinions, ranks caption matches first, and follows publication changes", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        const [provider] = await tx<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
        const [artifact] = await tx<{ id: string }[]>`
          INSERT INTO raw_artifact(provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
          VALUES (${provider!.id}, 'https://example.test/search-fix', ${"c".repeat(64)}, 'search-fix', 'application/json', now())
          RETURNING id`;
        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court(public_id, name, verification)
          VALUES ('jc-searchfix', 'Search Fixture Court', 'verified')
          RETURNING id`;
        const decide = (type: string, id: string, displayable = true) => tx`
          INSERT INTO publication_decision(
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version
          ) VALUES (${type}, ${id}, ${displayable}, true, true, false, false, 'fixture', 'v1')`;

        async function addOpinion(input: {
          key: string;
          caption: string;
          body: string;
          citations: number;
          publication?: "published" | "draft";
          displayable?: boolean;
        }) {
          const [legalCase] = await tx<{ id: string }[]>`
            INSERT INTO legal_case(public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${`jv-${input.key}`}, ${court!.id}, ${input.key}, ${input.caption}, '2024-05-01', ${input.publication ?? "published"})
            RETURNING id`;
          const [document] = await tx<{ id: string }[]>`
            INSERT INTO document(public_id, case_id, document_type, title, publication)
            VALUES (${`jd-${input.key}`}, ${legalCase!.id}, 'judicial_opinion', ${`${input.caption} opinion`}, ${input.publication ?? "published"})
            RETURNING id`;
          const [cluster] = await tx<{ id: string }[]>`
            INSERT INTO opinion_cluster(public_id, provider_id, provider_cluster_id, case_id, case_name, source_artifact_id)
            VALUES (${`joc-${input.key}`}, ${provider!.id}, ${input.key}, ${legalCase!.id}, ${input.caption}, ${artifact!.id})
            RETURNING id`;
          await tx`
            INSERT INTO opinion_search_projection(
              document_id, case_id, court_id, cluster_id, title, case_caption, court_name,
              date_filed, precedential_status, opinion_type, citation_count, body
            ) VALUES (
              ${document!.id}, ${legalCase!.id}, ${court!.id}, ${cluster!.id}, ${`${input.caption} opinion`},
              ${input.caption}, 'Search Fixture Court', '2024-05-01', 'Precedential', 'majority',
              ${input.citations}, ${input.body}
            )`;
          await decide("legal_case", legalCase!.id, input.displayable ?? true);
          await decide("document", document!.id, input.displayable ?? true);
          return { caseId: legalCase!.id, documentId: document!.id };
        }

        const padding = "introductory procedural history ".repeat(40);
        const captionMatch = await addOpinion({
          key: "searchfix1",
          caption: "Louisiana v. Callais",
          body: `${padding}The judgment is affirmed.`,
          citations: 1,
        });
        const bodyMatch = await addOpinion({
          key: "searchfix2",
          caption: "Other Holdings v. Agency",
          body: `${padding}The opinion discusses Callais only in this later passage.`,
          citations: 80,
        });
        await addOpinion({
          key: "searchfix3",
          caption: "Sealed Callais Matter",
          body: "Callais appears here but the record is not displayable.",
          citations: 5,
          displayable: false,
        });
        await addOpinion({
          key: "searchfix4",
          caption: "Draft Callais Matter",
          body: "Callais appears in a draft.",
          citations: 9,
          publication: "draft",
        });

        await tx`SELECT set_config('enable_seqscan', 'off', true)`;
        const plan = await tx<{ "QUERY PLAN": string }[]>`
          EXPLAIN
          SELECT projection.document_id
          FROM opinion_search_projection projection
          WHERE projection.search_vector @@ websearch_to_tsquery('english', 'Callais')`;
        expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("opinion_search_projection_vector_idx");

        const relevant = await searchPublicOpinions(sql, normalizeOpinionSearchFilters({ q: "Callais" }));
        expect(relevant.timedOut).toBeFalsy();
        expect(relevant.total).toBe(2);
        expect(relevant.results.map((result) => result.caseCaption)).toEqual([
          "Louisiana v. Callais",
          "Other Holdings v. Agency",
        ]);
        const bodyResult = relevant.results[1];
        expect(bodyResult?.excerpt).toContain("Callais");
        expect(bodyResult?.excerpt.startsWith("…")).toBe(true);

        const cited = await searchPublicOpinions(sql, normalizeOpinionSearchFilters({ q: "Callais", sort: "most-cited" }));
        expect(cited.results.map((result) => result.caseCaption)).toEqual([
          "Other Holdings v. Agency",
          "Louisiana v. Callais",
        ]);

        await tx`SELECT refresh_opinion_search_facets()`.catch(() => undefined);
        const facets = await listOpinionSearchFacets(sql);
        expect(facets.timedOut).toBeFalsy();
        expect(facets.courts.find((court) => court.value === "jc-searchfix")).toMatchObject({ count: 2 });
        expect(facets.opinionTypes.find((entry) => entry.value === "majority")?.count).toBeGreaterThanOrEqual(2);

        const filtered = await searchPublicOpinions(sql, normalizeOpinionSearchFilters({ q: "Callais", court: "jc-searchfix" }));
        expect(filtered.total).toBe(2);
        const unknownCourt = await searchPublicOpinions(sql, normalizeOpinionSearchFilters({ q: "Callais", court: "jc-missing" }));
        expect(unknownCourt.total).toBe(0);

        await tx`UPDATE legal_case SET publication = 'suppressed' WHERE id = ${captionMatch.caseId}`;
        const [captionVisible] = await tx<{ visible: boolean }[]>`
          SELECT visible FROM opinion_search_meta WHERE document_id = ${captionMatch.documentId}`;
        expect(captionVisible?.visible).toBe(false);
        expect((await searchPublicOpinions(sql, normalizeOpinionSearchFilters({ q: "Callais" }))).total).toBe(1);

        await tx`
          INSERT INTO publication_decision(
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version, decided_at
          ) VALUES ('document', ${bodyMatch.documentId}, false, false, false, false, false, 'fixture', 'v2', clock_timestamp())`;
        const [bodyVisible] = await tx<{ visible: boolean }[]>`
          SELECT visible FROM opinion_search_meta WHERE document_id = ${bodyMatch.documentId}`;
        expect(bodyVisible?.visible).toBe(false);
        expect((await searchPublicOpinions(sql, normalizeOpinionSearchFilters({ q: "Callais" }))).results).toEqual([]);

        await tx`DELETE FROM opinion_search_meta WHERE document_id = ${bodyMatch.documentId}`;
        await tx`
          INSERT INTO publication_decision(
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version, decided_at
          ) VALUES ('document', ${bodyMatch.documentId}, false, false, false, false, false, 'fixture', 'v3', clock_timestamp())`;
        const [rebuilt] = await tx<{ visible: boolean }[]>`
          SELECT visible FROM opinion_search_meta WHERE document_id = ${bodyMatch.documentId}`;
        expect(rebuilt?.visible).toBe(false);

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await client.end();
    }
  });

  it("cancels a statement that exceeds the timeout and leaves the connection usable", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      const error = await withStatementTimeout(client, 50, (tx) => tx`SELECT pg_sleep(2)`).then(() => null, (caught: unknown) => caught);
      expect(isStatementTimeout(error)).toBe(true);
      const [row] = await client<{ ok: number }[]>`SELECT 1 AS ok`;
      expect(row?.ok).toBe(1);
    } finally {
      await client.end();
    }
  });
});
