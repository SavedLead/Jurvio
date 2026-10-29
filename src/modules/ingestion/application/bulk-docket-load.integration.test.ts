import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { mergeDocketStage, stageCsv, stageDocket } from "./bulk-docket-load";
import type { CourtListenerBulkDocket } from "../providers/courtlistener/bulk-dockets";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("bulk docket merge", () => {
  it("inserts a draft case from a staged row and does not publish it", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const courtCode = `zzb${randomUUID().slice(0, 8)}`;
    const docketNumber = `9:26-cv-${randomUUID().slice(0, 6)}`;
    try {
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
      expect(provider?.id).toBeTruthy();
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-${courtCode}`}, ${provider!.id}, ${courtCode}, ${courtCode}, 'FD', 'not_verified')
        RETURNING id
      `;
      const staged = stageDocket({
        id: String(9_000_000_000 + Math.floor(Math.random() * 1_000_000)),
        court_id: courtCode,
        docket_number: docketNumber,
        case_name: "Bulk Measurement v. Example",
        date_filed: "2026-03-01",
        date_terminated: "",
        date_modified: "2026-03-02T00:00:00Z",
        cause: "",
        nature_of_suit: "440",
      } as CourtListenerBulkDocket);
      expect(staged).not.toBeNull();
      const counts = await mergeDocketStage(sql, provider!.id, stageCsv([staged!]));
      expect(counts.inserted).toBe(1);
      const [row] = await sql<{ publication: string; decisions: number; indexed: number }[]>`
        SELECT legal_case.publication::text AS publication,
          (SELECT count(*)::int FROM publication_decision
            WHERE object_type = 'legal_case' AND object_id = legal_case.id) AS decisions,
          (SELECT count(*)::int FROM opinion_search_projection
            WHERE case_id = legal_case.id) AS indexed
        FROM legal_case
        WHERE court_id = ${court!.id} AND docket_number = ${docketNumber}
      `;
      expect(row?.publication).toBe("draft");
      expect(row?.decisions).toBe(0);
      expect(row?.indexed).toBe(0);
    } finally {
      await sql`
        DELETE FROM legal_case
        WHERE court_id IN (SELECT id FROM court WHERE provider_court_id = ${courtCode})
      `;
      await sql`DELETE FROM court WHERE provider_court_id = ${courtCode}`;
      await sql.end();
    }
  });
});
