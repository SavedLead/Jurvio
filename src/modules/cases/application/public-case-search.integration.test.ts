import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { listPublicCases } from "./list-public-cases";
import { publicCaseSearchReady, refreshPublicCaseSearch, resetPublicCaseSearchReadyMemo } from "./public-case-search";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}
type Sql = Parameters<typeof listPublicCases>[0];

// Runs against a migrated database inside a transaction that is always rolled back.
describe.skipIf(!databaseUrl)("precomputed /cases text search", () => {
  it("returns exactly what the live text conditions return, after one full sweep", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        await tx`UPDATE public_case_search_state SET sweep_cursor = NULL, sweep_completed_at = NULL WHERE id = 1`;
        resetPublicCaseSearchReadyMemo();
        const decide = (type: string, id: string, displayable = true) => tx`
          INSERT INTO publication_decision(object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES (${type}, ${id}, ${displayable}, true, true, false, false, 'fixture', 'v1')`;
        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court(public_id, name, verification, provider_court_id) VALUES ('jc-srchfix01', 'Search Fixture Court', 'verified', 'srchfix01') RETURNING id`;
        const addCase = async (publicId: string, caption: string, docket: string, displayable = true, publication = "published") => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case(public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${publicId}, ${court!.id}, ${docket}, ${caption}, '2024-05-01', ${publication}) RETURNING id`;
          await decide("legal_case", row!.id, displayable);
          return row!.id;
        };
        const addParty = async (caseId: string, publicId: string, name: string, asFiled: string, type: string) => {
          const [entity] = await tx<{ id: string }[]>`
            INSERT INTO entity(public_id, entity_type, display_name, normalized_name)
            VALUES (${publicId}, ${type}, ${name}, ${name.toLowerCase()}) RETURNING id`;
          await tx`INSERT INTO party_appearance(case_id, entity_id, role, party_name_as_filed) VALUES (${caseId}, ${entity!.id}, 'party', ${asFiled})`;
        };
        await addCase("jv-srchfix01", "Quuxbridge Mills v. Fixture", "1:24-cv-00001");
        const partyHit = await addCase("jv-srchfix02", "Alpha v. Beta", "1:24-cv-00002");
        await addParty(partyHit, "je-srchfix01", "Quuxbridge Holdings Inc.", "QUUXBRIDGE HOLDINGS", "organization");
        const firmHit = await addCase("jv-srchfix03", "Gamma v. Delta", "1:24-cv-00003");
        await addParty(firmHit, "je-srchfix02", "Quuxbridge & Partners LLP", "Quuxbridge & Partners", "law_firm");
        await addCase("jv-srchfix04", "Quuxbridge Hidden v. Secret", "1:24-cv-00004", false);
        await addCase("jv-srchfix05", "Quuxbridge Draft v. Pending", "1:24-cv-00005", true, "draft");
        await addCase("jv-srchfix06", "Unrelated v. Other", "1:24-cv-quux");

        const options = (extra: Record<string, unknown>) => ({ page: 1, pageSize: 50, court: "jc-srchfix01", ...extra });
        const queries = [{ query: "quuxbridge" }, { query: "QUUX" }, { query: "cv-0000" }, { party: "quuxbridge" }, { firm: "quuxbridge" }, { query: "nothing-matches" }];
        const live = [];
        for (const extra of queries) live.push(await listPublicCases(sql, options(extra)));
        expect(live[0]!.cases.map((row) => row.publicId).sort()).toEqual(["jv-srchfix01", "jv-srchfix02", "jv-srchfix03"]);
        expect(await publicCaseSearchReady(sql)).toBe(false);

        const result = await refreshPublicCaseSearch(sql, { pauseMs: 0, batchSize: 2, log: () => {} });
        expect(result.sweepCompleted).toBe(true);
        const [stored] = await tx<{ search_text: string }[]>`SELECT search_text FROM public_case_search WHERE case_id = ${partyHit}`;
        expect(stored!.search_text).toContain("QUUXBRIDGE HOLDINGS");
        expect(stored!.search_text).toContain("Quuxbridge Holdings Inc.");
        const [draft] = await tx`SELECT 1 FROM public_case_search WHERE public_id = 'jv-srchfix05'`;
        expect(draft).toBeUndefined();

        resetPublicCaseSearchReadyMemo();
        expect(await publicCaseSearchReady(sql)).toBe(true);
        for (const [index, extra] of queries.entries()) {
          expect(await listPublicCases(sql, options(extra)), JSON.stringify(extra)).toEqual(live[index]);
        }

        // A case published after the sweep is added by the next run's new-case pass.
        const late = await addCase("jv-srchfix07", "Late Quuxbridge v. Newcomer", "1:24-cv-00007");
        const before = await listPublicCases(sql, options({ query: "late quuxbridge" }));
        expect(before.total).toBe(0);
        const next = await refreshPublicCaseSearch(sql, { pauseMs: 0, batchSize: 2, maxBatches: 1, log: () => {} });
        expect(next.added).toBe(1);
        const after = await listPublicCases(sql, options({ query: "late quuxbridge" }));
        expect(after.cases.map((row) => row.publicId)).toEqual(["jv-srchfix07"]);
        expect(late).toBeTruthy();

        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      resetPublicCaseSearchReadyMemo();
      await client.end();
    }
  });
});
