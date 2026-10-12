import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { ingestCourtListenerBulkCourts } from "./ingest-courtlistener-bulk-courts";

const databaseUrl = process.env.DATABASE_URL;

// A tiny CSV in the CourtListener bulk-courts shape. full_name is quoted because court
// names contain commas.
function csv(rows: Array<{ id: string; full: string; jur: string }>): string {
  const header = "id,pacer_court_id,short_name,full_name,url,jurisdiction,date_modified";
  const body = rows.map(({ id, full, jur }) =>
    `${id},,${id.toUpperCase()},"${full}",https://www.courtlistener.com/c/${id}/,${jur},2026-01-01`);
  return [header, ...body].join("\n") + "\n";
}

describe.skipIf(!databaseUrl)("courtlistener bulk court loader verification", () => {
  it("verifies registry courts, leaves others unverified, and never downgrades", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const schema = `court_load_${randomUUID().replaceAll("-", "")}`;
    const dir = await mkdtemp(join(tmpdir(), "bulk-courts-"));
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
      const foundation = await readFile("db/migrations/0001_foundation.sql", "utf8");
      await sql.unsafe(foundation.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));

      // Simulate a court another authoritative pipeline already verified but which is NOT
      // on our registry -- the loader must never downgrade it.
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code='courtlistener'`;
      await sql`INSERT INTO court(public_id,provider_id,provider_court_id,name,short_name,jurisdiction,verification)
        VALUES('jc-preverif1',${provider!.id},'preverified','Pre-Verified Special Court','PVSC','FS','verified')`;

      const file = join(dir, "courts.csv");
      await writeFile(file, csv([
        { id: "nysd", full: "District Court, S.D. New York", jur: "FD" },     // current district -> verified
        { id: "bta", full: "United States Board of Tax Appeals", jur: "FS" }, // historical -> verified
        { id: "mspb", full: "Merit Systems Protection Board", jur: "FS" },    // admin tribunal -> not_verified
        { id: "totallyfake", full: "Not A Real Court", jur: "FD" },           // unknown -> not_verified
        { id: "preverified", full: "Pre-Verified Special Court", jur: "FS" }, // not on registry -> keep verified
      ]));

      const result = await ingestCourtListenerBulkCourts(sql, file, "2026-09-30");
      expect(result.processed).toBe(5);

      const verif = async (id: string) =>
        (await sql<{ verification: string }[]>`SELECT verification::text FROM court WHERE provider_court_id=${id}`)[0]?.verification;
      expect(await verif("nysd")).toBe("verified");
      expect(await verif("bta")).toBe("verified");
      expect(await verif("mspb")).toBe("not_verified");
      expect(await verif("totallyfake")).toBe("not_verified");
      // Not on the registry, but previously verified elsewhere -> never downgraded.
      expect(await verif("preverified")).toBe("verified");

      // Re-running is idempotent and still verifies the registry courts.
      await ingestCourtListenerBulkCourts(sql, file, "2026-09-30");
      expect(await verif("nysd")).toBe("verified");
      expect(await verif("mspb")).toBe("not_verified");
    } finally {
      await sql.unsafe(`SET search_path TO public; DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
