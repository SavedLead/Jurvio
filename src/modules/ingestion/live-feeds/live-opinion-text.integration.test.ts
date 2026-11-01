import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { CITATION_WEB_MIGRATIONS, citationTestSchema } from "@/modules/citations/application/test-migrations";
import type { ArtifactStore } from "../application/artifact-store";
import { discoverLiveOpinionText, processLiveOpinionText } from "./live-opinion-text";

const url = process.env.DATABASE_URL;
const pdf = (marker: string) => new TextEncoder().encode(`%PDF-1.4 ${marker}`);

describe.skipIf(!url)("live-feed opinion text (database)", () => {
  it("queues live-feed opinions, extracts text into draft documents, skips sealed and duplicates", { timeout: 60_000 }, async () => {
    const sql = postgres(url!, { max: 1, onnotice: () => undefined });
    const fx = await citationTestSchema(sql, "livetext", ["0002_artifact_provenance.sql", ...CITATION_WEB_MIGRATIONS,
      "0145_govinfo_daily.sql", "0147_free_source_item.sql", "0174_live_opinion_text.sql"]);
    try {
      await sql`INSERT INTO provider (code, name, base_url) VALUES ('official_cmecf', 'Official federal court CM/ECF', 'https://pacer.uscourts.gov') ON CONFLICT DO NOTHING`;
      const site = await fx.addCase("jv-livetxsite", null, "Doe v. Roe", { publication: "draft", docket: "1:25-cv-00001" });
      const sealed = await fx.addCase("jv-livetxseal", null, "In re Sealed Matter", { publication: "draft", docket: "1:25-mj-00002" });
      const coa = await fx.addCase("jv-livetxcoaa", null, "Smith v. Jones", { publication: "draft", docket: "24-1234" });
      const gov = await fx.addCase("jv-livetxgovi", null, "United States v. Lee", { publication: "draft", docket: "2:24-cr-00009" });
      const dup = await fx.addCase("jv-livetxdupl", null, "Acme v. Widget", { publication: "draft", docket: "3:25-cv-00004" });
      await fx.addOpinion(dup, Array.from({ length: 200 }, () => "word").join(" "), { filedOn: "2026-10-30", publication: "draft" });
      await sql`UPDATE document_content SET word_count = 200`;
      await sql`INSERT INTO free_source_item (source, item_key, court_code, docket_number, issued_on, outcome, case_id) VALUES
        ('court_site', 'https://www.ded.uscourts.gov/sites/ded/files/opinions/25-1.pdf', 'ded', '1:25-cv-00001', '2026-10-31', 'entry', ${site}),
        ('court_site', 'https://www.ded.uscourts.gov/sites/ded/files/opinions/25-2.pdf', 'ded', '1:25-mj-00002', '2026-10-31', 'entry', ${sealed}),
        ('court_site', 'https://www.ded.uscourts.gov/sites/ded/files/opinions/25-4.pdf', 'ded', '3:25-cv-00004', '2026-10-30', 'matched', ${dup}),
        ('court_site', 'https://www.ded.uscourts.gov/sites/ded/files/opinions/old.pdf', 'ded', '1:25-cv-00001', '2026-01-01', 'entry', ${site})`;
      await sql`UPDATE free_source_item SET seen_at = now() - interval '30 days' WHERE item_key LIKE '%old.pdf'`;
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'official_cmecf'`;
      const [entry] = await sql<{ id: string }[]>`INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, filed_on, description)
        VALUES ('je-livetx0001', ${coa}, ${provider!.id}, 'coa-feed:ca3:24-1234:https://www2.ca3.uscourts.gov/opinarch/241234p.pdf', '2026-10-31',
          'Precedential opinion: https://www2.ca3.uscourts.gov/opinarch/241234p.pdf') RETURNING id`;
      await sql`INSERT INTO govinfo_crosscheck (package_id, date_issued, court_code, docket_number, outcome, case_id) VALUES
        ('USCOURTS-nywd-2_24-cr-00009', '2026-10-29', 'nywd', '2:24-cr-00009', 'entry', ${gov}),
        ('USCOURTS-ca5-25-60590', '2026-10-29', 'ca5', '25-60590', 'entry', ${coa})`;

      const discovered = await discoverLiveOpinionText(sql, { backfillDays: 3 });
      // Sealed docket, the 30-day-old item and the circuit GovInfo package are not queued.
      expect(discovered).toEqual({ court_site: 2, coa_feed: 1, govinfo: 1 });
      expect((await discoverLiveOpinionText(sql, { backfillDays: 3 }))).toEqual({ court_site: 0, coa_feed: 0, govinfo: 0 });
      expect((await discoverLiveOpinionText(sql, { rescanDays: 60 })).court_site).toBe(1);

      const requested: string[] = [];
      const fetchImpl = (async (target: string | URL, init?: RequestInit) => {
        const href = String(target);
        requested.push(href);
        expect(href).not.toContain("api_key");
        if (href.includes("/granules?")) {
          expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
          return Response.json({ granules: [{ granuleId: "USCOURTS-nywd-2_24-cr-00009-0" }, { granuleId: "USCOURTS-nywd-2_24-cr-00009-1" }] });
        }
        if (href.endsWith("/summary")) return Response.json({ dateIssued: href.includes("-1/summary") ? "2026-10-29" : "2025-01-01" });
        if (href.includes("old.pdf")) return new Response("missing", { status: 404 });
        return new Response(pdf(href));
      }) as typeof fetch;
      const stored: string[] = [];
      const store: ArtifactStore = { async putIfAbsent(input) { stored.push(input.key); return { objectKey: input.key }; } };
      const text = (href: string) => `OPINION ${href}\n\n` + Array.from({ length: 150 }, () => "See Brown v. Board of Education, 347 U.S. 483 (1954).").join(" ");
      const result = await processLiveOpinionText(sql, {
        store, limit: 10, deadline: Date.now() + 30_000, userAgent: "Jurvio test agent", govinfoApiKey: "test-key",
        allowOcr: false, minHostIntervalMs: 500, fetchImpl, sleep: async () => undefined,
        extract: async (bytes) => {
          const marker = new TextDecoder().decode(bytes).slice(9);
          return marker.includes("25-1.pdf") || marker.includes("241234p") || marker.includes("-1.pdf")
            ? { text: text(marker), pages: 2, method: "native_pdf_text" } : null;
        },
      });
      expect(result).toMatchObject({ claimed: 5, extracted: 3, duplicate: 1, failed: 1 });
      expect(requested).toContain("https://www.govinfo.gov/content/pkg/USCOURTS-nywd-2_24-cr-00009/pdf/USCOURTS-nywd-2_24-cr-00009-1.pdf");
      expect(stored).toHaveLength(3);
      const docs = await sql<{ case_id: string; publication: string; docket_entry_id: string | null; words: number; queued: boolean }[]>`
        SELECT d.case_id, d.publication::text, d.docket_entry_id, dc.word_count AS words,
          EXISTS (SELECT 1 FROM document_citation_work w WHERE w.document_id = d.id) AS queued
        FROM live_opinion_text q JOIN document d ON d.id = q.document_id JOIN document_content dc ON dc.document_id = d.id
        WHERE q.state = 'extracted' ORDER BY q.source`;
      expect(docs.map((d) => d.case_id).sort()).toEqual([site, coa, gov].sort());
      expect(docs.every((d) => d.publication === "draft" && d.words > 100 && d.queued)).toBe(true);
      expect(docs.find((d) => d.case_id === coa)?.docket_entry_id).toBe(entry!.id);
      expect(await sql`SELECT 1 FROM live_opinion_text WHERE case_id = ${sealed}`).toHaveLength(0);
    } finally {
      await fx.drop();
      await sql.end();
    }
  });
});
