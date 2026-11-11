import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { splitMigrationChunks } from "../scripts/migration-chunks.js";
import { refreshPublicDirectoryStats } from "../src/modules/directory/application/public-directory-stats";

const databaseUrl = process.env.DATABASE_URL;
class Rollback extends Error {}

const migration = readFileSync("db/migrations/0206_published_case_counter.sql", "utf8");
const install = readFileSync("db/migrations/0207_published_case_counter_v2.sql", "utf8");
const light = readFileSync("db/migrations/0208_published_count_seed_light.sql", "utf8");
const chunks = splitMigrationChunks(migration);
const installChunks = splitMigrationChunks(install);
const lightChunks = splitMigrationChunks(light);
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
        expect(chunks.join("\n")).not.toContain("CALL seed_court_published_counts");
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

  it("resumes after an interruption and reconciles a court the partial seed already counted", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const suffix = Math.random().toString(36).slice(2, 8);
    const first = "ffffffff-ffff-ffff-ffff-ffffffffff01";
    const second = "ffffffff-ffff-ffff-ffff-ffffffffff02";
    try {
      await client.begin(async (tx) => {
        for (const chunk of chunks) await tx.unsafe(chunk);
        await tx`
          INSERT INTO published_count_seed_cursor (singleton, court_id, seeded)
          VALUES (1, 'ffffffff-ffff-ffff-ffff-ffffffffff00', 0)
          ON CONFLICT (singleton) DO UPDATE SET court_id = EXCLUDED.court_id, seeded = 0
        `;
        const addCourt = async (id: string, stale: number) => {
          await tx`
            INSERT INTO court (id, public_id, name, verification, provider_court_id)
            VALUES (${id}::uuid, ${`jc-${id.slice(-4)}-${suffix}`}, 'Resume Court', 'verified', ${`resume-${id.slice(-4)}-${suffix}`})
          `;
          await tx`
            INSERT INTO court_public_stats (court_id, case_count, published_base, published_delta, recent_case_ids)
            VALUES (${id}::uuid, ${stale}, 0, 0, '{}')
          `;
        };
        const addCase = async (courtId: string, publicId: string, displayable = true) => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${publicId}, ${courtId}::uuid, ${publicId}, ${`Case ${publicId}`}, '2024-06-01', 'published')
            RETURNING id
          `;
          await tx`
            INSERT INTO publication_decision (
              object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version
            ) VALUES ('legal_case', ${row!.id}, ${displayable}, true, true, false, false, 'fixture', 'v1')
          `;
        };
        await addCourt(first, 10);
        await addCase(first, `jv-r${suffix}a`);
        await addCase(first, `jv-r${suffix}b`);
        await addCase(first, `jv-r${suffix}h`, false);
        await addCourt(second, 4);
        await addCase(second, `jv-r${suffix}c`);

        const next = async () => {
          const [row] = await tx<{ id: string | null }[]>`SELECT seed_next_published_count_court() AS id`;
          return row?.id ?? null;
        };
        const countOf = async (id: string) => {
          const [row] = await tx<{ case_count: number; published_delta: number }[]>`
            SELECT case_count, published_delta FROM court_public_stats WHERE court_id = ${id}::uuid
          `;
          return row;
        };

        expect(await next()).toBe(first);
        expect(await countOf(first)).toEqual({ case_count: 2, published_delta: 2 });
        // The fixture case was already published, so the trigger has added 1
        // to the stale recount. Seeding the first court must leave that alone.
        expect(await countOf(second)).toEqual({ case_count: 5, published_delta: 1 });

        expect(await next()).toBe(second);
        expect(await countOf(second)).toEqual({ case_count: 1, published_delta: 1 });
        expect(await countOf(first)).toEqual({ case_count: 2, published_delta: 2 });

        await addCase(first, `jv-r${suffix}d`);
        expect(await countOf(first)).toEqual({ case_count: 3, published_delta: 3 });
        const [snap] = await tx<{ counted: number; delta_at_count: number }[]>`
          SELECT
            (SELECT count(*)::int FROM legal_case
              WHERE court_id = ${first}::uuid AND legal_case_is_public(id, publication)) AS counted,
            coalesce((SELECT published_delta FROM court_public_stats WHERE court_id = ${first}::uuid), 0) AS delta_at_count
        `;
        await tx`SELECT apply_published_count_seed(${first}::uuid, ${snap!.counted}, ${snap!.delta_at_count})`;
        expect(await countOf(first)).toEqual({ case_count: 3, published_delta: 3 });

        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  });

  it("installs the resumable seed twice and marks complete only when no court remains", async () => {
    const client = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        expect(install).not.toContain("CALL ");
        for (let pass = 0; pass < 2; pass += 1) {
          for (const chunk of installChunks) await tx.unsafe(chunk);
        }
        const triggers = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_trigger
          WHERE NOT tgisinternal AND tgname = 'court_published_count_update'
        `;
        expect(triggers[0]?.n).toBe(1);
        const [procedure] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'seed_court_published_counts'
        `;
        expect(procedure?.n).toBe(0);
        await tx`
          INSERT INTO published_count_seed_cursor (singleton, court_id, seeded, complete)
          VALUES (1, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 0, false)
          ON CONFLICT (singleton) DO UPDATE
            SET court_id = EXCLUDED.court_id, seeded = 0, complete = false
        `;
        const [done] = await tx<{ id: string | null }[]>`
          SELECT seed_next_published_count_court() AS id
        `;
        expect(done?.id ?? null).toBeNull();
        const [cursor] = await tx<{ complete: boolean }[]>`
          SELECT complete FROM published_count_seed_cursor WHERE singleton = 1
        `;
        expect(cursor?.complete).toBe(true);
        for (const chunk of lightChunks) await tx.unsafe(chunk);
        const courtId = "ffffffff-ffff-ffff-ffff-ffffffffff11";
        const mark = "lightseed";
        await tx`
          INSERT INTO court (id, public_id, name, verification, provider_court_id)
          VALUES (${courtId}::uuid, ${`jc-${mark}`}, 'Light Seed Court', 'verified', ${`light-${mark}`})
        `;
        await tx`
          INSERT INTO court_public_stats (court_id, case_count, published_base, published_delta, recent_case_ids)
          VALUES (${courtId}::uuid, 9, 0, 4, '{}')
        `;
        const addCase = async (publicId: string, displayable: boolean) => {
          const [added] = await tx<{ id: string }[]>`
            INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, publication)
            VALUES (${publicId}, ${courtId}::uuid, ${publicId}, 'Light v. Seed', '2024-02-02', 'published')
            RETURNING id
          `;
          await tx`
            INSERT INTO publication_decision (
              object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version
            ) VALUES ('legal_case', ${added!.id}, ${displayable}, true, true, false, false, 'fixture', 'v1')
          `;
        };
        await addCase(`jv-${mark}-yes`, true);
        await addCase(`jv-${mark}-no`, false);
        const before = await tx<{ court_id: string }[]>`
          SELECT court_id::text FROM published_count_seed_cursor WHERE singleton = 1
        `;
        const [counted] = await tx<{ n: number }[]>`
          SELECT seed_published_count_for_court(${courtId}::uuid) AS n
        `;
        expect(counted?.n).toBe(1);
        const after = await tx<{ court_id: string }[]>`
          SELECT court_id::text FROM published_count_seed_cursor WHERE singleton = 1
        `;
        expect(after[0]?.court_id).toBe(before[0]?.court_id);
        const [stats] = await tx<{ case_count: number; published_delta: number }[]>`
          SELECT case_count, published_delta FROM court_public_stats WHERE court_id = ${courtId}::uuid
        `;
        expect(stats).toEqual({ case_count: 1, published_delta: 5 });
        throw new Rollback();
      }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
    } finally {
      await client.end();
    }
  });
});
