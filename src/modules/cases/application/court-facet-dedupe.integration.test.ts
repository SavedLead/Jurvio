import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { courtFacetKey, listPublicCaseCourtsLive, listPublicCases } from "./list-public-cases";

const databaseUrl = process.env.DATABASE_URL;

describe("court facet key", () => {
  it("treats a leading 'United States' as the same court", () => {
    expect(courtFacetKey("United States Court of Appeals for the Ninth Circuit")).toBe(courtFacetKey("Court of Appeals for the Ninth Circuit"));
    expect(courtFacetKey("Supreme Court of the United States")).toBe(courtFacetKey("Supreme Court of the United States"));
    expect(courtFacetKey("Court of Appeals for the Tenth Circuit")).not.toBe(courtFacetKey("Court of Appeals for the Ninth Circuit"));
  });
});

// Audit: /cases listed "Supreme Court of the United States" twice and both
// "Court of Appeals for the Ninth Circuit" and "United States Court of Appeals
// for the Ninth Circuit". Duplicate court rows must be one facet and one filter.
describe.skipIf(!databaseUrl)("court facet merges duplicate court rows", () => {
  const root = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  afterAll(async () => { if (databaseUrl) await root.end(); });

  it("groups by normalized name and filters across siblings", async () => {
    const rollback = new Error("rollback");
    await root.begin(async (tx) => {
      const sql = tx as unknown as typeof root;
      const name = `Court of Appeals for the Facet${tag} Circuit`;
      const courts: string[] = [];
      for (const [suffix, courtName] of [["a", name], ["b", `United States ${name}`]] as const) {
        const [court] = await sql<{ id: string }[]>`
          INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
          VALUES (${`jc-fd${tag}${suffix}`}, ${`fd${tag}${suffix}`}, ${courtName}, 'F', 'verified') RETURNING id`;
        courts.push(court!.id);
      }
      let n = 0;
      for (const [courtIndex, count] of [[0, 2], [1, 1]] as const) {
        for (let i = 0; i < count; i++) {
          n++;
          const [row] = await sql<{ id: string }[]>`
            INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
            VALUES (${`jv-fd${tag}${n}`}, ${courts[courtIndex]!}, ${`26-${tag}-${n}`}, ${`Facet ${tag} v. ${n}`}, 'published', 'verified') RETURNING id`;
          await sql`
            INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
            VALUES ('legal_case', ${row!.id}, true, true, true, false, false, 'test', 'test')`;
        }
      }
      const facets = (await listPublicCaseCourtsLive(sql)).filter((facet) => facet.label.includes(`Facet${tag}`));
      expect(facets).toEqual([{ value: `jc-fd${tag}a`, label: `United States ${name}`, count: 3 }]);
      for (const value of [`jc-fd${tag}a`, `jc-fd${tag}b`]) {
        const listing = await listPublicCases(sql, { page: 1, pageSize: 20, court: value, sort: "az" });
        expect(listing.total, value).toBe(3);
      }
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  });
});
