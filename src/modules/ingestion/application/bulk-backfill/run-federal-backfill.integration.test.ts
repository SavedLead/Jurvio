import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFederalBackfill, type FederalBackfillOptions } from "./run-federal-backfill";

const databaseUrl = process.env.DATABASE_URL;

function csv(headers: string[], rows: Record<string, string>[]): string {
  const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((name) => quote(row[name] ?? "")).join(","))]
    .join("\n") + "\n";
}

async function writeSnapshot(directory: string, snapshotDate: string, files: Record<string, string>) {
  const sums: string[] = [];
  for (const [kind, text] of Object.entries(files)) {
    const fileName = `${kind}-${snapshotDate}.csv.bz2`;
    const compressed = spawnSync("bzip2", ["-c"], { input: text });
    if (compressed.status !== 0) throw new Error("bzip2 is required for this test");
    await writeFile(path.join(directory, fileName), compressed.stdout);
    sums.push(`${createHash("sha256").update(compressed.stdout).digest("hex")}  ${fileName}`);
  }
  await writeFile(path.join(directory, "SHA256SUMS"), `${sums.join("\n")}\n`);
}

describe.skipIf(!databaseUrl)("full federal CourtListener backfill (database)", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 4, onnotice: () => undefined });
  // Unique codes, ids and snapshot date per run so the test never collides with
  // other data in a shared database.
  const tag = `t${randomInt(1e6, 9e6)}`;
  const base = 3_000_000_000 + randomInt(0, 900_000) * 1_000;
  const id = (offset: number) => String(base + offset);
  // Progress rows are keyed by (snapshot date, stage), so each run needs its own
  // date; they are cleared up front in case a date is ever reused.
  const snapshotDate = `${randomInt(2100, 9000)}-${String(randomInt(1, 13)).padStart(2, "0")}-${String(randomInt(1, 29)).padStart(2, "0")}`;
  const court = { ca: `${tag}ca`, d: `${tag}d`, bk: `${tag}bk`, state: `${tag}st` };
  let directory = "";
  let providerId = "";

  const options = (overrides: Partial<FederalBackfillOptions> = {}): FederalBackfillOptions => ({
    snapshotDate,
    snapshotDir: directory,
    includeBankruptcy: true,
    includeScotus: false,
    governor: { targetBatchMs: 60_000, maxPauseMs: 0 },
    ...overrides,
  });

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "jurvio-backfill-"));
    const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    providerId = provider!.id;
    await sql`DELETE FROM cl_bulk_ingest_progress WHERE snapshot_date = ${snapshotDate}`;

    // Records that exist before the backfill: a case in another docket format, and
    // an opinion first loaded from the live API.
    const [apiArtifact] = await sql<{ id: string }[]>`
      INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at, response_metadata)
      VALUES (${providerId}, ${`https://www.courtlistener.com/api/rest/v4/opinions/${id(905)}/`},
        ${"a".repeat(64)}, ${`api/${tag}`}, 'application/json', now(), ${sql.json({ source: "courtlistener_api" })})
      RETURNING id`;
    const [districtCourt] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction)
      VALUES (${`jc-${tag}d`}, ${providerId}, ${court.d}, 'Test District', 'FD') RETURNING id`;
    const [existing] = await sql<{ id: string }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, source_artifact_id)
      VALUES (${`jv-${tag}x`}, ${districtCourt!.id}, '1:20-cv-00999', 'Existing v. Case', ${apiArtifact!.id})
      RETURNING id`;
    const [apiCluster] = await sql<{ id: string }[]>`
      INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, source_artifact_id)
      VALUES (${`jl-${tag}x`}, ${existing!.id}, ${providerId}, ${id(505)}, 'Existing v. Case (API)', ${apiArtifact!.id})
      RETURNING id`;
    const [apiDocument] = await sql<{ id: string }[]>`
      INSERT INTO document (public_id, case_id, document_type, title, content_hash, source_artifact_id)
      VALUES (${`jd-${tag}x`}, ${existing!.id}, 'judicial_opinion', 'API opinion', ${"b".repeat(64)}, ${apiArtifact!.id})
      RETURNING id`;
    await sql`
      INSERT INTO judicial_opinion (cluster_id, document_id, provider_id, provider_opinion_id, opinion_type, source_artifact_id)
      VALUES (${apiCluster!.id}, ${apiDocument!.id}, ${providerId}, ${id(905)}, 'majority', ${apiArtifact!.id})`;
    await sql`
      INSERT INTO document_content (document_id, content_html, content_text, content_hash, extraction_method, word_count, source_artifact_id)
      VALUES (${apiDocument!.id}, '<p>API text</p>', 'API text', ${"b".repeat(64)}, 'courtlistener_api', 2, ${apiArtifact!.id})`;

    const courtHeaders = ["id", "pacer_court_id", "short_name", "full_name", "url", "jurisdiction", "date_modified"];
    const courtRow = (code: string, jurisdiction: string) => ({
      id: code, short_name: code.toUpperCase(), full_name: `Court ${code}`, url: "https://example.test",
      jurisdiction, date_modified: "2026-09-30",
    });
    const docketHeaders = ["id", "court_id", "docket_number", "case_name", "date_filed", "date_terminated", "nature_of_suit", "cause", "date_modified"];
    const docket = (offset: number, courtCode: string, docketNumber: string, caseName: string, dateFiled = "1925-03-02") => ({
      id: id(offset), court_id: courtCode, docket_number: docketNumber, case_name: caseName,
      date_filed: dateFiled, date_modified: "2026-09-01 10:00:00.5+00",
    });
    const clusterHeaders = ["id", "docket_id", "case_name", "case_name_full", "date_filed", "precedential_status", "citation_count", "judges", "date_modified"];
    const cluster = (offset: number, docketOffset: number, caseName: string) => ({
      id: id(offset), docket_id: id(docketOffset), case_name: caseName, date_filed: "1925-03-09",
      precedential_status: "Published", citation_count: "3", judges: "Learned Hand", date_modified: "2026-09-01 10:00:00+00",
    });
    const opinionHeaders = ["id", "cluster_id", "type", "author_str", "per_curiam", "plain_text", "html_with_citations", "xml_harvard", "sha1", "date_modified"];

    await writeSnapshot(directory, snapshotDate, {
      courts: csv(courtHeaders, [
        courtRow(court.ca, "F"), courtRow(court.d, "FD"), courtRow(court.bk, "FB"),
        courtRow(court.state, "S"), courtRow("scotus", "F"),
      ]),
      dockets: csv(docketHeaders, [
        docket(1, court.ca, "21-1234", "United States v. Appellant"),
        docket(2, court.d, "1:21-cr-00042", "United States v. Defendant"),
        docket(3, court.bk, "", "In re Debtor"),
        docket(4, court.d, "", ""),
        docket(5, court.state, "A-1", "State v. Person"),
        docket(6, "scotus", "21-476", "Supreme v. Court"),
        docket(7, court.d, "1:20cv00999", "Existing v. Case, Longer Bulk Caption"),
        docket(8, court.d, "", "In re Second Unnumbered"),
        docket(9, court.d, "1999-55", "Old v. Case", "1799-02-30"),
      ]),
      "opinion-clusters": csv(clusterHeaders, [
        cluster(101, 1, "United States v. Appellant"),
        cluster(102, 2, "United States v. Defendant"),
        cluster(103, 3, "In re Debtor"),
        cluster(104, 5, "State v. Person"),
        cluster(106, 4, "Named Only By Cluster"),
        cluster(505, 7, "Existing v. Case (bulk)"),
      ]),
      citations: csv(["id", "volume", "reporter", "page", "type", "cluster_id"], [
        { id: id(2), volume: "1", reporter: "F.2d", page: "10", type: "1", cluster_id: id(101) },
        { id: id(1), volume: "5", reporter: "U.S.", page: "20", type: "1", cluster_id: id(101) },
        { id: id(3), volume: "9", reporter: "A.2d", page: "30", type: "2", cluster_id: id(104) },
        { id: id(4), volume: "7", reporter: "F. Supp.", page: "40", type: "1", cluster_id: id(505) },
      ]),
      opinions: csv(opinionHeaders, [
        { id: id(901), cluster_id: id(101), type: "020lead", author_str: "Hand", per_curiam: "f",
          html_with_citations: "<p>The appeal is <b>affirmed</b>.</p>", xml_harvard: "<opinion>affirmed</opinion>", sha1: "x" },
        { id: id(902), cluster_id: id(102), type: "040dissent", plain_text: "I dissent\u0000 \"strongly\",\nfor reasons." },
        { id: id(903), cluster_id: id(103), type: "010combined", plain_text: "   " },
        { id: id(904), cluster_id: id(104), type: "010combined", plain_text: "State opinion." },
        { id: id(905), cluster_id: id(505), type: "010combined", plain_text: "Bulk text must not replace API text." },
        { id: id(906), cluster_id: id(106), type: "010combined", plain_text: "Named by cluster." },
      ]),
    });
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
    await sql.end({ timeout: 5 });
  });

  const caseFor = async (docketOffset: number) => {
    const [row] = await sql<{ id: string; docket_number: string; caption: string; court: string; filed_on: string | null; updated_at: Date }[]>`
      SELECT legal_case.id, legal_case.docket_number, legal_case.caption, court.provider_court_id AS court,
        legal_case.filed_on::text AS filed_on, legal_case.updated_at
      FROM case_identifier identifier
      JOIN legal_case ON legal_case.id = identifier.case_id
      JOIN court ON court.id = legal_case.court_id
      WHERE identifier.provider_id = ${providerId} AND identifier.identifier_type = 'courtlistener_docket_id'
        AND identifier.identifier_value = ${id(docketOffset)}`;
    return row;
  };

  it("stops at a batch boundary and resumes to the same result", async () => {
    const stopped = await runFederalBackfill(
      sql,
      options({ stages: ["dockets"], maxRowsPerStage: 1, batchRows: { dockets: 2 } }),
    );
    expect(stopped.status).toBe("stopped");
    expect(stopped.stages[0]).toMatchObject({ status: "stopped", stopReason: "row_limit", rowsScanned: 2 });
    // The cursor sits after the committed batch; the next run continues from it.
  });

  it("loads federal dockets, clusters, citations and opinions with bankruptcy and history", async () => {
    const outboxBefore = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM outbox_event`;
    const result = await runFederalBackfill(sql, options());
    expect(result.status).toBe("completed");
    expect(result.scopeKey).toBe("federal-full");
    expect(result.courts).toBe(3);
    expect(result.stages.map((stage) => stage.status)).toEqual(
      ["completed", "completed", "completed", "completed", "completed"],
    );

    // Dockets: appellate, district and bankruptcy load; state and SCOTUS do not.
    expect((await caseFor(1))?.court).toBe(court.ca);
    expect((await caseFor(3))).toMatchObject({ court: court.bk, docket_number: `courtlistener-docket-${id(3)}` });
    expect(await caseFor(5)).toBeUndefined();
    expect(await caseFor(6)).toBeUndefined();
    // Two unnumbered dockets in one court stay two cases.
    expect((await caseFor(4))?.id).not.toBe((await caseFor(8))?.id);
    // An impossible 1799 date is dropped instead of failing the batch.
    expect((await caseFor(9))?.filed_on).toBeNull();
    // An existing case in another docket format is reused and only gains data.
    const existing = await caseFor(7);
    expect(existing).toMatchObject({ docket_number: "1:20-cv-00999", caption: "Existing v. Case, Longer Bulk Caption" });
    // A docket with no name takes its cluster's.
    expect((await caseFor(4))?.caption).toBe("Named Only By Cluster");

    // Clusters attach to their docket's case; citations fold in by id order.
    const [appellate] = await sql<{ citations: unknown; judges: string; case_id: string }[]>`
      SELECT citations, judges, case_id FROM opinion_cluster WHERE provider_id = ${providerId} AND provider_cluster_id = ${id(101)}`;
    expect(appellate?.case_id).toBe((await caseFor(1))?.id);
    expect(appellate?.citations).toEqual([
      { volume: "5", reporter: "U.S.", page: "20", type: "1" },
      { volume: "1", reporter: "F.2d", page: "10", type: "1" },
    ]);
    const [stateCluster] = await sql`SELECT 1 FROM opinion_cluster WHERE provider_cluster_id = ${id(104)}`;
    expect(stateCluster).toBeUndefined();
    // The API-loaded cluster keeps its record but gains citations it lacked.
    const [apiCluster] = await sql<{ case_name: string; citations: unknown[] }[]>`
      SELECT case_name, citations FROM opinion_cluster WHERE provider_id = ${providerId} AND provider_cluster_id = ${id(505)}`;
    expect(apiCluster).toMatchObject({ case_name: "Existing v. Case (API)" });
    expect(apiCluster?.citations).toHaveLength(1);

    // Opinions: one rendering stored, text cleaned, metadata without text copies.
    const [lead] = await sql<{ content_html: string; content_text: string; provider_metadata: Record<string, unknown>; body: string; publication: string }[]>`
      SELECT content.content_html, content.content_text, judicial.provider_metadata, projection.body, document.publication
      FROM judicial_opinion judicial
      JOIN document ON document.id = judicial.document_id
      JOIN document_content content ON content.document_id = judicial.document_id
      JOIN opinion_search_projection projection ON projection.document_id = judicial.document_id
      WHERE judicial.provider_id = ${providerId} AND judicial.provider_opinion_id = ${id(901)}`;
    expect(lead?.content_html).toBe("<p>The appeal is <b>affirmed</b>.</p>");
    expect(lead?.content_text).toBe("The appeal is affirmed .");
    expect(lead?.body).toBe(lead?.content_text);
    expect(lead?.publication).toBe("draft");
    expect(lead?.provider_metadata).not.toHaveProperty("html_with_citations");
    expect(lead?.provider_metadata).not.toHaveProperty("xml_harvard");
    expect(lead?.provider_metadata.text_columns).toEqual({ html_with_citations: 37, xml_harvard: 27 });
    const [dissent] = await sql<{ content_text: string }[]>`
      SELECT content.content_text FROM judicial_opinion judicial
      JOIN document_content content ON content.document_id = judicial.document_id
      WHERE judicial.provider_opinion_id = ${id(902)}`;
    expect(dissent?.content_text).toBe('I dissent "strongly",\nfor reasons.');
    const [empty] = await sql`SELECT 1 FROM judicial_opinion WHERE provider_opinion_id = ${id(903)}`;
    expect(empty).toBeUndefined();
    const [api] = await sql<{ content_text: string }[]>`
      SELECT content.content_text FROM judicial_opinion judicial
      JOIN document_content content ON content.document_id = judicial.document_id
      WHERE judicial.provider_opinion_id = ${id(905)}`;
    expect(api?.content_text).toBe("API text");

    // Provenance: rows point at the checksummed snapshot file.
    const [provenance] = await sql<{ source_uri: string; object_key: string; content_hash: string }[]>`
      SELECT artifact.source_uri, artifact.object_key, artifact.content_hash
      FROM document_content content
      JOIN judicial_opinion judicial ON judicial.document_id = content.document_id
      JOIN raw_artifact artifact ON artifact.id = content.source_artifact_id
      WHERE judicial.provider_opinion_id = ${id(901)}`;
    expect(provenance?.source_uri).toMatch(new RegExp(`/bulk-data/opinions-${snapshotDate}\\.csv\\.bz2$`));
    expect(provenance?.object_key).toBe(`courtlistener/bulk-mirror/${snapshotDate}/opinions-${snapshotDate}.csv.bz2`);
    expect(provenance?.content_hash).toMatch(/^[a-f0-9]{64}$/);

    // No per-row outbox events; the staged citations are cleared.
    const outboxAfter = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM outbox_event`;
    expect(outboxAfter[0]?.count).toBe(outboxBefore[0]?.count);
    const [staged] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM cl_bulk_citation_stage WHERE snapshot_date = ${snapshotDate}`;
    expect(staged?.count).toBe(0);
  });

  it("is a no-op when replayed over the same snapshot", async () => {
    const before = await caseFor(1);
    const done = await runFederalBackfill(sql, options());
    expect(done.stages.map((stage) => stage.status)).toEqual(
      ["already_done", "already_done", "already_done", "already_done", "already_done"],
    );

    await sql`DELETE FROM cl_bulk_ingest_progress WHERE snapshot_date = ${snapshotDate}`;
    const replay = await runFederalBackfill(sql, options());
    const written = Object.fromEntries(replay.stages.map((stage) => [stage.stage, stage.rowsWritten]));
    expect(written["federal-full:clusters"]).toBe(0);
    expect(written["federal-full:citations-apply"]).toBe(0);
    expect(written["federal-full:opinions"]).toBe(0);
    expect((await caseFor(1))?.updated_at).toEqual(before?.updated_at);
  });
});
