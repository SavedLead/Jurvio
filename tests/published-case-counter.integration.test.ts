import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { splitMigrationChunks } from "../scripts/migration-chunks.js";
import { refreshPublicDirectoryStats } from "../src/modules/directory/application/public-directory-stats";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}

const migration = readFileSync("db/migrations/0206_published_case_counter.sql", "utf8");
const chunks = splitMigrationChunks(migration).filter((chunk) => !chunk.includes("CALL seed_court_published_counts"));
const triggerNames = [
  "court_published_count_insert",
  "court_published_count_delete",
  "court_published_count_update",
  "court_published_count_decision_insert",
  "court_published_count_decision_update",
  "court_published_count_decision_delete",
];

describe.skipIf(!databaseUrl)("published case counter migration", () => {
  it("applies twice, leaves one trigger of each name, and does not count a live delta twice", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const suffix = Math.random().toString(36).slice(2, 10);
    try {
      await client.begin(async (tx) => {
        for (let pass = 0; pass < 2; pass += 1) {
          for (const chunk of chunks) await tx.unsafe(chunk);
        }

        const triggers = await tx<{ tgname: string; n: number }[]>`
          SELECT tgname, count(*)::int AS n
          FROM pg_trigger
          WHERE NOT tgisinternal AND tgname LIKE 'court_published_count%'
          GROUP BY tgname
          ORDER BY tgname
        `;
        expect(triggers.map((row) => row.tgname)).toEqual([...triggerNames].sort());
        expect(triggers.every((row) => row.n === 1)).toBe(true);

        const [court] = await tx<{ id: string }[]>`
          INSERT INTO court (public_id, name, verification, provider_court_id)
          VALUES (${`jc-seed${suffix}`}, 'Seed Idempotent Court', 'verified', ${`seed${suffix}`})
          RETURNING id
        `;
        // The failed production run left the old recount in case_count and then
        // the live trigger added publishes on top. 10 is that stale recount.
        await tx`
          INSERT INTO court_public_stats (court_id, case_count, published_base, published_delta, recent_case_ids)
          VALUES (${court!.id}, 10, 0, 0, '{}')
        `;
        const addCase = async (publicId: string, displayable: boolean, publication = "published") => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${publicId}, ${court!.id}, ${publicId}, ${`Case ${publicId}`}, '2024-01-02', ${publication})
            RETURNING id
          `;
          await tx`
            INSERT INTO publication_decision (
              object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version
            ) VALUES ('legal_case', ${row!.id}, ${displayable}, true, true, false, false, 'fixture', 'v1')
          `;
        };
        await addCase(`jv-seed${suffix}a`, true);
        await addCase(`jv-seed${suffix}b`, true);
        await addCase(`jv-seed${suffix}h`, false);
        await addCase(`jv-seed${suffix}d`, true, "draft");

        const seed = async () => {
          const [snap] = await tx<{ counted: number; delta_at_count: number }[]>`
            SELECT
              (SELECT count(*)::int FROM legal_case
                WHERE court_id = ${court!.id} AND legal_case_is_public(id, publication)) AS counted,
              coalesce((SELECT published_delta FROM court_public_stats WHERE court_id = ${court!.id}), 0) AS delta_at_count
          `;
          await tx`SELECT apply_published_count_seed(${court!.id}, ${snap!.counted}, ${snap!.delta_at_count})`;
        };

        await seed();
        const [once] = await tx<{ case_count: number; published_base: number; published_delta: number }[]>`
          SELECT case_count, published_base, published_delta
          FROM court_public_stats WHERE court_id = ${court!.id}
        `;
        expect(once).toEqual({ case_count: 2, published_base: 0, published_delta: 2 });

        await seed();
        const [twice] = await tx<{ case_count: number; published_delta: number }[]>`
          SELECT case_count, published_delta FROM court_public_stats WHERE court_id = ${court!.id}
        `;
        expect(twice).toEqual({ case_count: 2, published_delta: 2 });

        await addCase(`jv-seed${suffix}c`, true);
        await seed();
        const [after] = await tx<{ case_count: number; published_delta: number }[]>`
          SELECT case_count, published_delta FROM court_public_stats WHERE court_id = ${court!.id}
        `;
        expect(after).toEqual({ case_count: 3, published_delta: 3 });

        await refreshPublicDirectoryStats(tx as unknown as Parameters<typeof refreshPublicDirectoryStats>[0], { pauseMs: 0 });
        const [refreshed] = await tx<{ case_count: number }[]>`
          SELECT case_count FROM court_public_stats WHERE court_id = ${court!.id}
        `;
        expect(refreshed?.case_count).toBe(3);

        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  });
});
