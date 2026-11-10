import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { refreshPublicDirectoryStats } from "./public-directory-stats";
import { getPublicCourt, getPublicCourtLive, listPublicCourts, listPublicCourtsLive } from "./public-directory";
import { listPublicCaseCourts, listPublicCaseCourtsLive } from "@/modules/cases/application/list-public-cases";
import { listPublicJudgePage, listPublicJudges } from "@/modules/judges/application/public-judge-analytics";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}
type Sql = Parameters<typeof refreshPublicDirectoryStats>[0];

// Runs against a migrated database inside a transaction that is always rolled back.
describe.skipIf(!databaseUrl)("precomputed public directory stats", () => {
  it("stores the same counts the live queries compute and the readers use them", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        // Start from empty stats so the fixture is the only data that matters.
        await tx`DELETE FROM court_public_stats`;
        await tx`DELETE FROM judge_public_stats`;
        const decide = (type: string, id: string, displayable = true) => tx`
          INSERT INTO publication_decision(object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES (${type}, ${id}, ${displayable}, true, true, false, false, 'fixture', 'v1')`;
        const [provider] = await tx<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
        const [artifact] = await tx<{ id: string }[]>`
          INSERT INTO raw_artifact(provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
          VALUES (${provider!.id}, 'https://example.test/stats', ${"c".repeat(64)}, 'stats-fixture', 'application/json', now()) RETURNING id`;
        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court(public_id, name, verification, provider_court_id) VALUES ('jc-statfix01', 'Stats Fixture Court', 'verified', 'statfix01') RETURNING id`;
        const [emptyCourt] = await tx<{ id: string }[]>`
          INSERT INTO court(public_id, name, verification, provider_court_id) VALUES ('jc-statfix02', 'Empty Stats Court', 'verified', 'statfix02') RETURNING id`;

        const addCase = async (publicId: string, filedOn: string, displayable = true, publication = "published") => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case(public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${publicId}, ${court!.id}, ${publicId}, ${`Case ${publicId}`}, ${filedOn}, ${publication}) RETURNING id`;
          await decide("legal_case", row!.id, displayable);
          return row!.id;
        };
        const a = await addCase("jv-statfix01", "2024-01-02");
        const b = await addCase("jv-statfix02", "2025-03-04");
        const hidden = await addCase("jv-statfix03", "2026-01-01", false);
        await addCase("jv-statfix04", "2026-02-01", true, "draft");
        await decide("court", emptyCourt!.id);

        const [judge] = await tx<{ id: string }[]>`
          INSERT INTO judge(public_id, display_name, normalized_name, court_id, verification)
          VALUES ('jj-statfix01', 'Judge Fixture', 'judge fixture', ${court!.id}, 'verified') RETURNING id`;
        await decide("judge", judge!.id);
        const [unverified] = await tx<{ id: string }[]>`
          INSERT INTO judge(public_id, display_name, normalized_name, court_id, verification)
          VALUES ('jj-statfix02', 'Unverified Fixture', 'unverified fixture', ${court!.id}, 'not_verified') RETURNING id`;
        for (const [judgeId, caseId] of [[judge!.id, a], [judge!.id, b], [judge!.id, hidden], [unverified!.id, a]] as const) {
          await tx`INSERT INTO judge_case_assignment(judge_id, case_id, source_artifact_id, extraction_method, extractor_version, confidence)
            VALUES (${judgeId}, ${caseId}, ${artifact!.id}, 'source_field', 'fixture', 0.95)`;
        }
        await tx`INSERT INTO judge_case_observation(judge_id, case_id, observation_type, favored_side, extraction_method, extractor_version, confidence, fingerprint)
          VALUES (${judge!.id}, ${a}, 'case_outcome', 'plaintiff', 'source_field', 'fixture', 0.9, 'fx-1'),
                 (${judge!.id}, ${hidden}, 'case_outcome', 'defendant', 'source_field', 'fixture', 0.9, 'fx-2')`;

        const liveCourt = await getPublicCourtLive(sql, "jc-statfix01");
        const liveFacet = (await listPublicCaseCourtsLive(sql)).find((row) => row.value === "jc-statfix01");
        const liveCourts = (await listPublicCourtsLive(sql, 200)).find((row) => row.publicId === "jc-statfix01");
        const liveJudge = (await listPublicJudges(sql)).find((row) => row.publicId === "jj-statfix01");

        // Before any refresh the readers fall back to the live queries.
        expect((await getPublicCourt(sql, "jc-statfix01"))?.caseCount).toBe(2);

        const events: Array<Record<string, unknown>> = [];
        const result = await refreshPublicDirectoryStats(sql, { pauseMs: 0, courtBatch: 1, judgeBatch: 1, log: (event) => events.push(event) });
        expect(result.courts.upserted).toBeGreaterThanOrEqual(2);
        expect(events.some((event) => event.directoryStats === "batch" && event.kind === "court")).toBe(true);

        const [courtStats] = await tx<{ case_count: number; latest_case_date: string; recent_case_ids: string[] }[]>`
          SELECT case_count, latest_case_date::text, recent_case_ids::text[] FROM court_public_stats WHERE court_id = ${court!.id}`;
        // The publication trigger counts every published row, including the
        // non-displayable one. The refresh must not recount over it.
        expect(courtStats).toEqual({ case_count: 3, latest_case_date: "2025-03-04", recent_case_ids: [b, a] });
        const [judgeStats] = await tx<{ case_count: number; outcome_sample: number }[]>`
          SELECT case_count, outcome_sample FROM judge_public_stats WHERE judge_id = ${judge!.id}`;
        expect(judgeStats).toEqual({ case_count: 2, outcome_sample: 1 });
        const [unverifiedStats] = await tx`SELECT 1 FROM judge_public_stats WHERE judge_id = ${unverified!.id}`;
        expect(unverifiedStats).toBeUndefined();

        // Readers return what the live queries returned.
        const stored = await getPublicCourt(sql, "jc-statfix01");
        expect(stored?.caseCount).toBe(3);
        expect(liveCourt?.caseCount).toBe(2);
        expect(stored?.cases.map((row) => row.publicId)).toEqual(["jv-statfix02", "jv-statfix01"]);
        expect((await listPublicCaseCourts(sql)).find((row) => row.value === "jc-statfix01")?.count).toBe(3);
        expect(liveFacet?.count).toBe(2);
        expect((await listPublicCourts(sql, 200)).find((row) => row.publicId === "jc-statfix01")?.caseCount).toBe(3);
        expect(liveCourts?.caseCount).toBe(2);
        const judgePage = await listPublicJudgePage(sql, { page: 1, pageSize: 50 });
        expect(judgePage.judges.find((row) => row.publicId === "jj-statfix01")).toEqual(liveJudge);
        expect(judgePage.judges.some((row) => row.publicId === "jj-statfix02")).toBe(false);
        expect(await getPublicCourt(sql, "jc-statfix02")).toBeNull();

        // A case unpublished after the refresh disappears from the stored list at once.
        await tx`
          INSERT INTO publication_decision(object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version, decided_at)
          VALUES ('legal_case', ${b}, false, false, false, false, false, 'fixture', 'v1', now() + interval '1 second')`;
        expect((await getPublicCourt(sql, "jc-statfix01"))?.cases.map((row) => row.publicId)).toEqual(["jv-statfix01"]);
        await tx`UPDATE legal_case SET publication = 'draft' WHERE id = ${hidden}`;
        expect((await tx<{ case_count: number }[]>`SELECT case_count FROM court_public_stats WHERE court_id = ${court!.id}`)[0]?.case_count).toBe(2);

        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  });
});
