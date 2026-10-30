import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { openBulkCsv } from "../providers/courtlistener/bulk";
import { readBulkOpinions } from "../providers/courtlistener/bulk-opinions";
import { BULK_OPINION_HOLD_REASON, bulkOpinionStreamName, loadCourtListenerBulkOpinions } from "./bulk-opinion-load";

const databaseUrl = process.env.DATABASE_URL;

function csvCell(value: string): string {
  return /[",\n\\]/.test(value) ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : value;
}

describe.skipIf(!databaseUrl)("bulk opinion load", () => {
  it("merges federal opinions set-based as draft and held, skips bankruptcy/scotus/unmatched/existing, and is idempotent", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const tag = randomUUID().slice(0, 8);
    const snapshotDate = "2099-02-01";
    const dir = mkdtempSync(join(tmpdir(), "bulk-opinions-"));
    const file = join(dir, "opinions.csv");
    const base = 7_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const providerId = provider!.id;
    const codes = { fd: `zzfd${tag}`, fb: `zzfb${tag}`, scotus: "scotus" };
    const createdCourts: string[] = [];
    try {
      const courtId = async (code: string, jurisdiction: string) => {
        const [existing] = await sql<{ id: string }[]>`SELECT id FROM court WHERE provider_id = ${providerId} AND provider_court_id = ${code}`;
        if (existing) return existing.id;
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
          VALUES (${`jc-${code}`}, ${providerId}, ${code}, ${code}, ${jurisdiction}, 'not_verified') RETURNING id`;
        createdCourts.push(code);
        return row!.id;
      };
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
        VALUES (${providerId}, ${`test://cluster/${tag}`}, ${tag}, ${`test/${tag}`}, 'application/json', now()) RETURNING id`;
      const cluster = async (court: string, clusterId: string, publication = "draft") => {
        const [legalCase] = await sql<{ id: string }[]>`
          INSERT INTO legal_case (public_id, court_id, docket_number, caption, verification, publication)
          VALUES (${`case-${tag}-${clusterId}`}, ${court}, ${`1:99-cv-${clusterId}`}, ${`Case ${clusterId} v. Test`}, 'not_verified', ${publication}::publication_state)
          RETURNING id`;
        await sql`
          INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, date_filed, precedential_status, citation_count, source_artifact_id)
          VALUES (${`cl-${tag}-${clusterId}`}, ${legalCase!.id}, ${providerId}, ${clusterId}, ${`Case ${clusterId} v. Test`}, '2020-01-02', 'Published', 3, ${artifact!.id})`;
        return legalCase!.id;
      };
      const fd = await courtId(codes.fd, "FD");
      const fb = await courtId(codes.fb, "FB");
      const scotus = await courtId(codes.scotus, "F");
      const c = (n: number) => String(base + n);
      const federalCase = await cluster(fd, c(1));
      await cluster(fb, c(2));
      await cluster(scotus, c(3));
      const publishedCase = await cluster(fd, c(4), "published");

      const header = "id,cluster_id,type,author_str,per_curiam,download_url,sha1,plain_text,html_with_citations,date_modified";
      const rows = [
        [c(101), c(1), "010combined", "Judge A", "f", "", "", "First federal opinion, with a comma and \"quotes\".", "", "2020-01-03"],
        [c(102), c(1), "040dissent", "Judge B", "f", "", "", "", "<p>Dissent &amp; html</p>", "2020-01-03"],
        [c(103), c(2), "010combined", "", "f", "", "", "Bankruptcy opinion", "", "2020-01-03"],
        [c(104), c(3), "010combined", "", "t", "", "", "SCOTUS opinion", "", "2020-01-03"],
        [c(105), c(99), "010combined", "", "f", "", "", "No such cluster", "", "2020-01-03"],
        [c(106), c(1), "010combined", "", "f", "", "", "   ", "", "2020-01-03"],
        [c(107), c(4), "010combined", "Judge C", "f", "", "", "Opinion on a published case", "", "2020-01-03"],
      ];
      writeFileSync(file, `${header}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
      const run = () => loadCourtListenerBulkOpinions(sql, {
        opinions: readBulkOpinions(openBulkCsv(file)),
        snapshotDate, rowLimit: 1_000, budgetMs: 60_000, allowAnytime: true, chunkRows: 3, diskPath: dir, log: () => {},
      });

      const first = await run();
      expect(first.stopped).toBe("complete");
      expect(first.rowsConsumed).toBe(7);
      expect(first.mergedThisRun).toBe(3);
      expect(first.nonFederal).toBe(2);
      expect(first.unmatched).toBe(1);
      expect(first.empty).toBe(1);
      expect(first.documentsHeld).toBe(3);

      const docs = await sql<{ opinion: string; publication: string; text: string; projected: boolean; doc_held: string[] | null; review: string | null; source: string }[]>`
        SELECT jo.provider_opinion_id AS opinion, d.publication::text AS publication, content.content_text AS text,
          EXISTS(SELECT 1 FROM opinion_search_projection p WHERE p.document_id = d.id) AS projected,
          (SELECT reasons FROM citation_publication_hold h WHERE h.document_id = d.id) AS doc_held,
          (SELECT status FROM publication_review r WHERE r.object_type = 'document' AND r.object_id = d.id) AS review,
          a.response_metadata->>'source' AS source
        FROM judicial_opinion jo
        JOIN document d ON d.id = jo.document_id
        JOIN document_content content ON content.document_id = d.id
        JOIN raw_artifact a ON a.id = content.source_artifact_id
        WHERE jo.provider_id = ${providerId} AND jo.provider_opinion_id = ANY(${[c(101), c(102), c(103), c(104), c(105), c(106), c(107)]}::text[])
        ORDER BY jo.provider_opinion_id`;
      expect(docs.map((doc) => doc.opinion)).toEqual([c(101), c(102), c(107)]);
      for (const doc of docs) {
        expect(doc.publication).toBe("draft");
        expect(doc.projected).toBe(true);
        expect(doc.doc_held).toEqual([BULK_OPINION_HOLD_REASON]);
        expect(doc.review).toBe("pending");
        expect(doc.source).toBe("courtlistener_bulk");
      }
      expect(docs[0]!.text).toBe('First federal opinion, with a comma and "quotes".');
      expect(docs[1]!.text).toBe("Dissent & html");
      const holds = await sql<{ case_id: string; reasons: string[] }[]>`
        SELECT case_id, reasons FROM federal_publication_hold WHERE case_id = ANY(${[federalCase, publishedCase]}::uuid[])`;
      expect(holds).toEqual([{ case_id: federalCase, reasons: [BULK_OPINION_HOLD_REASON] }]);
      const [published] = await sql<{ publication: string }[]>`SELECT publication::text FROM legal_case WHERE id = ${publishedCase}`;
      expect(published!.publication).toBe("published");

      // Re-running a finished snapshot from a reset checkpoint writes nothing new.
      const again = await loadCourtListenerBulkOpinions(sql, {
        opinions: readBulkOpinions(openBulkCsv(file)),
        snapshotDate, rowLimit: 1_000, budgetMs: 60_000, allowAnytime: true, resetCheckpoint: true, chunkRows: 3, diskPath: dir, log: () => {},
      });
      expect(again.mergedThisRun).toBe(0);
      expect(again.alreadyPresent).toBe(3);
      const [count] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM judicial_opinion WHERE provider_id = ${providerId}
          AND provider_opinion_id = ANY(${[c(101), c(102), c(107)]}::text[])`;
      expect(count!.n).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await sql`DELETE FROM ingestion_checkpoint WHERE provider_id = ${providerId} AND stream_name = ${bulkOpinionStreamName(snapshotDate)}`;
      await sql`DELETE FROM publication_review WHERE object_type = 'document' AND object_id IN (
        SELECT document_id FROM judicial_opinion WHERE provider_id = ${providerId} AND provider_opinion_id LIKE ${`${String(base).slice(0, 4)}%`})`;
      await sql`DELETE FROM legal_case WHERE public_id LIKE ${`case-${tag}-%`}`;
      await sql`DELETE FROM raw_artifact WHERE source_uri LIKE ${`https://www.courtlistener.com/help/api/bulk-data/#opinion-${snapshotDate}-%`} OR source_uri = ${`test://cluster/${tag}`}`;
      for (const code of createdCourts) await sql`DELETE FROM court WHERE provider_court_id = ${code}`;
      await sql.end();
    }
  }, 60_000);

  it("keeps the checkpoint at the last merged chunk when the budget ends", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const snapshotDate = "2099-02-02";
    const dir = mkdtempSync(join(tmpdir(), "bulk-opinions-"));
    const file = join(dir, "opinions.csv");
    const rows = Array.from({ length: 8 }, (_, n) => `${6_000_000_000 + n},${6_000_000_000 + n},010combined,x`);
    writeFileSync(file, `id,cluster_id,type,plain_text\n${rows.join("\n")}\n`);
    let calls = 0;
    try {
      const result = await loadCourtListenerBulkOpinions(sql, {
        opinions: readBulkOpinions(openBulkCsv(file)),
        snapshotDate, rowLimit: 1_000, budgetMs: 1_000, allowAnytime: true, chunkRows: 3, diskPath: dir, log: () => {},
        now: () => (++calls > 8 ? 10_000_000 : 1_000 + calls),
      });
      expect(result.stopped).toBe("budget");
      expect(result.rowsConsumed % 3).toBe(0);
      expect(result.rowsConsumed).toBeLessThan(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
      await sql`DELETE FROM ingestion_checkpoint WHERE provider_id = ${provider!.id} AND stream_name = ${bulkOpinionStreamName(snapshotDate)}`;
      await sql.end();
    }
  }, 60_000);
});
