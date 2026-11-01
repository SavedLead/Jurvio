import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { courtSourceFromRow, type DirectRegistryRow } from "../application/direct-court-rotation";
import { ingestDirectCourtFeed } from "../application/ingest-direct-court-feed";
import { createArtifactStore } from "../infrastructure/create-artifact-store";

const databaseUrl = process.env.DATABASE_URL;
const xml = readFileSync(join(__dirname, "fixtures", "nyed-ready-dockets.rss.xml"), "latin1");

describe.skipIf(!databaseUrl)("EDNY readyDockets ingestion", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("stores sealed entries suppressed with no case or docket entry, and is idempotent", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200, headers: { "content-type": "text/xml" } })));
    const store = createArtifactStore({ localRoot: mkdtempSync(join(tmpdir(), "nyed-")) });
    const [row] = await sql<DirectRegistryRow[]>`
      SELECT court_code, court_name, jurvio_court_code, court_type, circuit, official_website, cmecf_base_url,
        'https://ecf.nyed.uscourts.gov/cgi-bin/readyDockets.pl' AS rss_url, 24 AS rss_coverage_hours,
        '["all"]'::jsonb AS included_event_categories, pacer_court_id, time_zone, polling_minutes
      FROM direct_court_registry WHERE court_code = 'nyed'`;
    expect(row).toBeTruthy();
    try {
      await sql`DELETE FROM direct_court_alert_event WHERE direct_event_id IN (SELECT id FROM direct_court_event WHERE court_code = 'nyed')`;
      await sql`DELETE FROM direct_court_event WHERE court_code = 'nyed'`;
      const first = await ingestDirectCourtFeed(sql, store, courtSourceFromRow(row!));
      expect(first).toMatchObject({ retrieved: 16, inserted: 16 });
      const sealed = await sql<{ case_id: string | null; publication_state: string; restricted: boolean; docket_number: string }[]>`
        SELECT case_id, publication_state, restricted, docket_number FROM direct_court_event
        WHERE court_code = 'nyed' AND exact_docket_text ILIKE '%sealed%'`;
      expect(sealed).toHaveLength(2);
      for (const event of sealed) {
        expect(event.restricted).toBe(true);
        expect(event.publication_state).toBe("suppressed");
      }
      const sealedCase = await sql`SELECT 1 FROM legal_case lc JOIN court c ON c.id = lc.court_id
        WHERE lower(c.provider_court_id) = 'nyed' AND lc.docket_number = '1:26-mj-01180'`;
      expect(sealedCase).toHaveLength(0);
      const sealedEntries = await sql`SELECT 1 FROM docket_entry WHERE description ILIKE '%sealed document%'
        AND provider_entry_id IN (SELECT deduplication_key FROM direct_court_event WHERE court_code = 'nyed')`;
      expect(sealedEntries).toHaveLength(0);
      const [log] = await sql<{ http_status: number; items: number; new_items: number }[]>`
        SELECT http_status, items, new_items FROM court_fetch_log WHERE court_code = 'nyed' ORDER BY id DESC LIMIT 1`;
      expect(log).toMatchObject({ http_status: 200, items: 16, new_items: 16 });

      const second = await ingestDirectCourtFeed(sql, store, courtSourceFromRow(row!));
      expect(second).toMatchObject({ retrieved: 16, inserted: 0 });
    } finally {
      await sql`DELETE FROM court_fetch_log WHERE court_code = 'nyed'`;
      await sql.end();
    }
  });
});
