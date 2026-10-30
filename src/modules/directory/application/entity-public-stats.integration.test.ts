import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { refreshEntityPublicStats } from "./public-directory-stats";
import { listPublicEntities, listPublicEntitiesLive } from "./public-directory";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}
type Sql = Parameters<typeof refreshEntityPublicStats>[0];

// Runs against a migrated database inside a transaction that is always rolled back.
describe.skipIf(!databaseUrl)("precomputed party and law-firm counts", () => {
  it("matches the live aggregate across resumed batches and publishes a generation", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        await tx`UPDATE public_stats_generation SET published_generation = NULL, published_at = NULL, building_generation = NULL, building_cursor = NULL WHERE name = 'entity'`;
        await tx`DELETE FROM entity_public_stats`;
        const decide = (type: string, id: string, displayable = true) => tx`
          INSERT INTO publication_decision(object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES (${type}, ${id}, ${displayable}, true, true, false, false, 'fixture', 'v1')`;
        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court(public_id, name, verification, provider_court_id) VALUES ('jc-entfix01', 'Entity Fixture Court', 'verified', 'entfix01') RETURNING id`;
        const cases: string[] = [];
        for (let i = 1; i <= 5; i += 1) {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case(public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${`jv-entfix0${i}`}, ${court!.id}, ${`E-${i}`}, ${`Entity case ${i}`}, ${`2024-0${i}-01`}, 'published') RETURNING id`;
          await decide("legal_case", row!.id, i !== 5);
          cases.push(row!.id);
        }
        const addEntity = async (publicId: string, type: string, caseIndexes: number[], displayable = true) => {
          const [entity] = await tx<{ id: string }[]>`
            INSERT INTO entity(public_id, entity_type, display_name, normalized_name)
            VALUES (${publicId}, ${type}, ${`Name ${publicId}`}, ${publicId}) RETURNING id`;
          if (!displayable) await decide("entity", entity!.id, false);
          for (const index of caseIndexes) {
            await tx`INSERT INTO party_appearance(case_id, entity_id, role, party_name_as_filed) VALUES (${cases[index]!}, ${entity!.id}, 'party', ${publicId})`;
            await tx`INSERT INTO party_appearance(case_id, entity_id, role, party_name_as_filed) VALUES (${cases[index]!}, ${entity!.id}, 'counsel', ${publicId})`;
          }
        };
        await addEntity("je-entfix01", "organization", [0, 1, 2, 3, 4]);
        await addEntity("je-entfix02", "person", [1, 3]);
        await addEntity("je-entfix03", "law_firm", [0, 2, 3]);
        await addEntity("je-entfix04", "organization", [0], false);

        const liveParties = await listPublicEntitiesLive(sql, "party", 100);
        const liveFirms = await listPublicEntitiesLive(sql, "law_firm", 100);
        expect(liveParties.find((row) => row.publicId === "je-entfix01")?.caseCount).toBe(4);

        // Two batches per run: the first run pauses mid-pass, later runs resume and publish.
        const first = await refreshEntityPublicStats(sql, { batchSize: 2, maxBatches: 1, pauseMs: 0, log: () => {} });
        expect(first).toMatchObject({ ran: true, published: false });
        expect(await listPublicEntities(sql, "party", 100)).toEqual(liveParties);
        let result = first;
        for (let i = 0; i < 1000 && !result.published; i += 1) {
          result = await refreshEntityPublicStats(sql, { batchSize: 2, maxBatches: 1, pauseMs: 0, log: () => {} });
        }
        expect(result.published).toBe(true);
        const fixtureIds = (rows: Array<{ publicId: string }>) => rows.filter((row) => row.publicId.startsWith("je-entfix"));
        expect(fixtureIds(await listPublicEntities(sql, "party", 100))).toEqual(fixtureIds(liveParties));
        expect(fixtureIds(await listPublicEntities(sql, "law_firm", 100))).toEqual(fixtureIds(liveFirms));

        // A fresh generation is reused; a forced pass replaces it and drops the old rows.
        expect((await refreshEntityPublicStats(sql, { pauseMs: 0, log: () => {} })).ran).toBe(false);
        const forced = await refreshEntityPublicStats(sql, { pauseMs: 0, force: true, log: () => {} });
        expect(forced.published).toBe(true);
        const [old] = await tx`SELECT 1 FROM entity_public_stats WHERE generation < ${forced.generation!}`;
        expect(old).toBeUndefined();
        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  });
});
