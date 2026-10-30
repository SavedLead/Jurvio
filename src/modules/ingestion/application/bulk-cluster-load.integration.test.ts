import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { openBulkCsv } from "../providers/courtlistener/bulk";
import { readBulkOpinionClusters, readBulkOpinions } from "../providers/courtlistener/bulk-opinions";
import { bulkClusterStreamName, loadCourtListenerBulkClusters } from "./bulk-cluster-load";
import { BULK_OPINION_HOLD_REASON, bulkOpinionStreamName, loadCourtListenerBulkOpinions } from "./bulk-opinion-load";

const databaseUrl = process.env.DATABASE_URL;

function csvCell(value: string): string {
  return /[",\n\\]/.test(value) ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : value;
}

function csv(header: string[], rows: string[][]): string {
  return `${header.join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

describe.skipIf(!databaseUrl)("bulk cluster load", () => {
  it("resolves opinion -> cluster -> docket -> case, keeps unmatched clusters pending, and only re-passes new clusters", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const tag = randomUUID().slice(0, 8);
    const snapshotDate = "2099-04-01";
    const laterSnapshot = "2099-05-01";
    const dir = mkdtempSync(join(tmpdir(), "bulk-clusters-"));
    const clusterFile = join(dir, "clusters.csv");
    const opinionFile = join(dir, "opinions.csv");
    const base = 8_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const id = (n: number) => String(base + n);
    const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const providerId = provider!.id;
    const codes = { fd: `zcfd${tag}`, fb: `zcfb${tag}` };
    const opinionIds = [1, 2, 3, 7, 10].map((n) => id(500 + n));
    try {
      const court = async (code: string, jurisdiction: string) => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
          VALUES (${`jc-${code}`}, ${providerId}, ${code}, ${code}, ${jurisdiction}, 'not_verified') RETURNING id`;
        return row!.id;
      };
      const fd = await court(codes.fd, "FD");
      const fb = await court(codes.fb, "FB");
      const legalCase = async (courtId: string, docket: number, publication = "draft") => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO legal_case (public_id, court_id, docket_number, caption, verification, publication)
          VALUES (${`case-${tag}-${docket}`}, ${courtId}, ${`1:97-cv-${tag}-${docket}`}, ${`Case ${docket} v. Test`}, 'not_verified', ${publication}::publication_state)
          RETURNING id`;
        await sql`
          INSERT INTO case_identifier (case_id, provider_id, identifier_type, identifier_value)
          VALUES (${row!.id}, ${providerId}, 'courtlistener_docket_id', ${id(docket)})`;
        return row!.id;
      };
      const caseA = await legalCase(fd, 101);
      const caseB = await legalCase(fd, 102, "published");
      await legalCase(fb, 103);
      await legalCase(fd, 104, "restricted");
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
        VALUES (${providerId}, ${`test://cluster/${tag}`}, ${tag}, ${`test/${tag}`}, 'application/json', now()) RETURNING id`;
      await sql`
        INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, source_artifact_id)
        VALUES (${`cl-${tag}-8`}, ${caseA}, ${providerId}, ${id(8)}, 'Existing v. Cluster', ${artifact!.id})`;

      const header = ["id", "date_created", "date_modified", "judges", "date_filed", "case_name_short", "case_name", "case_name_full",
        "syllabus", "headmatter", "citation_count", "precedential_status", "blocked", "docket_id"];
      const longText = "x".repeat(2_000);
      writeFileSync(clusterFile, csv(header, [
        [id(1), "", "2020-01-02 00:00:00+00", "Judge A", "2020-01-01", "", "Alpha v. Beta", "", "A syllabus", longText, "4", "Published", "f", id(101)],
        [id(2), "", "", "", "2020-02-01", "", "Gamma v. Delta, \"Inc.\"", "", "", "", "0", "Unpublished", "f", id(102)],
        [id(3), "", "", "", "2020-03-01", "", "In re Debtor", "", "", "", "0", "Published", "f", id(103)],
        [id(4), "", "", "", "2020-04-01", "", "Restricted v. Case", "", "", "", "0", "Published", "f", id(104)],
        [id(5), "", "", "", "2020-05-01", "", "In re Sealed Matter", "", "", "", "0", "Published", "f", id(101)],
        [id(6), "", "", "", "2020-06-01", "", "Blocked v. Person", "", "", "", "0", "Published", "t", id(101)],
        [id(7), "", "", "", "2020-07-01", "", "Later v. Docket", "", "", "", "2", "Published", "f", id(109)],
        [id(8), "", "", "", "2020-08-01", "", "Existing v. Cluster", "", "", "", "0", "Published", "f", id(101)],
      ]));
      const loadClusters = (snapshot: string, keepUnmatched?: boolean) => loadCourtListenerBulkClusters(sql, {
        openClusters: () => readBulkOpinionClusters(openBulkCsv(clusterFile)),
        snapshotDate: snapshot, rowLimit: 1_000, budgetMs: 60_000, allowAnytime: true, chunkRows: 3, diskPath: dir,
        keepUnmatched, log: () => {},
      });

      const first = await loadClusters(snapshotDate, true);
      expect(first.stopped).toBe("complete");
      expect(first.rowsConsumed).toBe(8);
      expect(first).toMatchObject({ created: 2, alreadyPresent: 1, pending: 1, unmatched: 0, nonFederal: 1, restricted: 3 });
      expect(first.casesHeld).toBe(1);
      const clusters = await sql<{ id: string; case_id: string; case_name: string; citation_count: number; syllabus: string | null; metadata: Record<string, unknown> }[]>`
        SELECT provider_cluster_id AS id, case_id, case_name, citation_count, syllabus, provider_metadata AS metadata
        FROM opinion_cluster WHERE provider_id = ${providerId} AND provider_cluster_id = ANY(${[1, 2, 3, 4, 5, 6, 7].map(id)}::text[])
        ORDER BY provider_cluster_id`;
      expect(clusters.map((row) => [row.id, row.case_id])).toEqual([[id(1), caseA], [id(2), caseB]]);
      expect(clusters[0]).toMatchObject({ case_name: "Alpha v. Beta", citation_count: 4, syllabus: "A syllabus" });
      expect(clusters[0]!.metadata).not.toHaveProperty("headmatter");
      expect(clusters[0]!.metadata._omitted).toEqual(["headmatter"]);
      expect(clusters[1]!.case_name).toBe('Gamma v. Delta, "Inc."');
      const holds = await sql<{ case_id: string; reasons: string[] }[]>`
        SELECT case_id, reasons FROM federal_publication_hold WHERE case_id = ANY(${[caseA, caseB]}::uuid[])`;
      expect(holds).toEqual([{ case_id: caseA, reasons: [BULK_OPINION_HOLD_REASON] }]);
      const [published] = await sql<{ publication: string }[]>`SELECT publication::text FROM legal_case WHERE id = ${caseB}`;
      expect(published!.publication).toBe("published");
      const pending = await sql<{ cluster_id: string; docket_id: string }[]>`
        SELECT cluster_id, docket_id FROM courtlistener_pending_cluster WHERE cluster_id = ${id(7)}`;
      expect(pending).toEqual([{ cluster_id: id(7), docket_id: id(109) }]);

      // Opinions: only clusters on loaded federal cases are in the set.
      const opinionHeader = ["id", "cluster_id", "type", "author_str", "per_curiam", "plain_text"];
      writeFileSync(opinionFile, csv(opinionHeader, [
        [id(501), id(1), "010combined", "Judge A", "f", "Alpha opinion text."],
        [id(502), id(2), "010combined", "", "t", "Gamma opinion text."],
        [id(503), id(3), "010combined", "", "f", "Bankruptcy text."],
        [id(507), id(7), "010combined", "", "f", "Later docket text."],
        [id(510), id(10), "010combined", "", "f", "Cluster added after the first pass."],
      ]));
      let opened = 0;
      const loadOpinions = () => loadCourtListenerBulkOpinions(sql, {
        openOpinions: () => { opened += 1; return readBulkOpinions(openBulkCsv(opinionFile)); },
        snapshotDate, rowLimit: 1_000, budgetMs: 60_000, allowAnytime: true, chunkRows: 2, diskPath: dir, log: () => {},
      });
      const before = await loadOpinions();
      expect(before.stopped).toBe("complete");
      expect(before.mergedThisRun).toBe(2);

      // The docket for cluster 7 arrives; the next cluster run attaches it without re-reading the file.
      const caseE = await legalCase(fd, 109);
      const second = await loadClusters(snapshotDate, true);
      expect(second.stopped).toBe("complete");
      expect(second.rowsReadThisRun).toBe(0);
      expect(second.pendingResolved).toMatchObject({ resolved: 1, created: 1 });
      const [late] = await sql<{ case_id: string }[]>`
        SELECT case_id FROM opinion_cluster WHERE provider_id = ${providerId} AND provider_cluster_id = ${id(7)}`;
      expect(late!.case_id).toBe(caseE);

      // A cluster created after the finished pass triggers pass 2, which stages only the new clusters.
      await sql`
        INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, source_artifact_id)
        VALUES (${`cl-${tag}-10`}, ${caseA}, ${providerId}, ${id(10)}, 'Alpha v. Beta', ${artifact!.id})`;
      const pass2 = await loadOpinions();
      expect(pass2.pass).toBe(2);
      expect(pass2.clustersSince).not.toBeNull();
      expect(pass2.clusterSetSize).toBeGreaterThanOrEqual(2);
      expect(pass2.mergedThisRun).toBe(2);
      expect(pass2.stopped).toBe("complete");
      const merged = await sql<{ id: string; publication: string }[]>`
        SELECT jo.provider_opinion_id AS id, d.publication::text AS publication
        FROM judicial_opinion jo JOIN document d ON d.id = jo.document_id
        WHERE jo.provider_id = ${providerId} AND jo.provider_opinion_id = ANY(${opinionIds}::text[])
        ORDER BY 1`;
      expect(merged).toEqual([id(501), id(502), id(507), id(510)].map((value) => ({ id: value, publication: "draft" })));

      // Nothing new since pass 2 began: the 55 GB file is not opened again.
      const openedBefore = opened;
      const idle = await loadOpinions();
      expect(idle.stopped).toBe("complete");
      expect(opened).toBe(openedBefore);

      // Once the docket load for a snapshot is complete, unmatched clusters are dropped, not kept.
      await sql`
        INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
        VALUES (${providerId}, ${`courtlistener:bulk-dockets:v1:${laterSnapshot}`}, ${JSON.stringify({ version: 1, snapshotDate: laterSnapshot, rowsConsumed: 1, stopped: "complete" })})`;
      await sql`
        INSERT INTO courtlistener_pending_cluster (cluster_id, docket_id, snapshot_date, case_name, public_id, provider_metadata)
        VALUES (${id(99)}, ${id(199)}, ${snapshotDate}, 'Never v. Loaded', ${`jo-${tag}`}, '{}')`;
      const later = await loadClusters(laterSnapshot);
      expect(later.keepUnmatched).toBe(false);
      expect(later.pendingResolved?.pruned).toBeGreaterThanOrEqual(1);
      expect(later.pending).toBe(0);
      expect(later.unmatched).toBe(0);
      expect(later.alreadyPresent).toBe(4);
      const [left] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM courtlistener_pending_cluster WHERE cluster_id = ${id(99)}`;
      expect(left!.n).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await sql`DELETE FROM ingestion_checkpoint WHERE provider_id = ${providerId} AND stream_name IN (
        ${bulkClusterStreamName(snapshotDate)}, ${bulkClusterStreamName(laterSnapshot)}, ${bulkOpinionStreamName(snapshotDate)},
        ${`courtlistener:bulk-dockets:v1:${laterSnapshot}`})`;
      await sql`DELETE FROM courtlistener_pending_cluster WHERE cluster_id LIKE ${`${String(base).slice(0, 4)}%`}`;
      await sql`DELETE FROM publication_review WHERE object_type = 'document' AND object_id IN (
        SELECT document_id FROM judicial_opinion WHERE provider_id = ${providerId} AND provider_opinion_id = ANY(${opinionIds}::text[]))`;
      await sql`DELETE FROM legal_case WHERE public_id LIKE ${`case-${tag}-%`}`;
      await sql`DELETE FROM raw_artifact WHERE source_uri LIKE ${`https://www.courtlistener.com/help/api/bulk-data/#opinion-${snapshotDate}-%`}
        OR source_uri = ${`test://cluster/${tag}`} OR source_uri LIKE '%/bulk-data/opinion-clusters-2099-0%'`;
      await sql`DELETE FROM court WHERE provider_court_id IN (${codes.fd}, ${codes.fb})`;
      await sql.end();
    }
  }, 60_000);
});
