import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ingestFjcIdbParties } from "./ingest-fjc-idb-parties";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("FJC IDB party backfill", () => {
  it("matches (district, docket core, office, year) and writes plaintiff + defendant appearances", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const tag = randomUUID().replace(/-/g, "").slice(0, 8);
    const district = `fjc${tag}`;
    try {
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
      expect(provider?.id).toBeTruthy();
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-${district}`}, ${provider!.id}, ${district}, ${district}, 'Federal District', 'verified')
        RETURNING id`;
      const [match] = await sql<{ id: string }[]>`
        INSERT INTO legal_case (public_id, court_id, docket_number, caption, verification, publication, filed_on)
        VALUES (${`case-a${tag}`}, ${court!.id}, '2:21-cv-00123', 'Acme v. Widget', 'verified', 'draft', '2021-03-04')
        RETURNING id`;
      // Same core, other office: must not match the office-2 IDB row.
      await sql`
        INSERT INTO legal_case (public_id, court_id, docket_number, caption, verification, publication, filed_on)
        VALUES (${`case-b${tag}`}, ${court!.id}, '5:21-cv-00123', 'Other v. Case', 'verified', 'draft', '2021-05-06')`;

      const header = "id,office,docket_number,date_filed,plaintiff,defendant,circuit_id,district_id";
      const rows = [
        `"9${tag.replace(/\D/g, "1").slice(0, 6)}1","2","2100123","2021-03-04","ACME INC","WIDGET LLC","ca3","${district}"`,
        `"9${tag.replace(/\D/g, "1").slice(0, 6)}2","2","2100999","2021-03-04","NOBODY","NOONE","ca3","${district}"`,
      ];
      const dir = mkdtempSync(join(tmpdir(), "fjc-"));
      const file = join(dir, "fjc.csv");
      writeFileSync(file, `${header}\n${rows.join("\n")}\n`);

      const result = await ingestFjcIdbParties(sql as never, { filePath: file, snapshotDate: "2026-09-30", filingYear: 2021 });
      expect(result.failed).toBe(0);
      expect(result.matchedCases).toBe(1);
      expect(result.unmatchedCases).toBe(1);
      expect(result.appearancesWritten).toBe(2);

      const appearances = await sql<{ case_id: string; role: string; party_name_as_filed: string }[]>`
        SELECT case_id, role, party_name_as_filed FROM party_appearance
        WHERE case_id IN (SELECT id FROM legal_case WHERE court_id = ${court!.id}) ORDER BY role`;
      expect(appearances).toEqual([
        { case_id: match!.id, role: "defendant", party_name_as_filed: "WIDGET LLC" },
        { case_id: match!.id, role: "plaintiff", party_name_as_filed: "ACME INC" },
      ]);

      // Idempotent: a re-run writes no new rows.
      await ingestFjcIdbParties(sql as never, { filePath: file, snapshotDate: "2026-09-30", filingYear: 2021 });
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*) FROM party_appearance WHERE case_id = ${match!.id}`;
      expect(Number(count)).toBe(2);
    } finally {
      await sql.end();
    }
  });
});
