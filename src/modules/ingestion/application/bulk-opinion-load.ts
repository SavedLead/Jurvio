import { statfs } from "node:fs/promises";
import os from "node:os";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { CITED_OPINION_RULE_VERSION } from "@/modules/citations/application/publish-cited-federal-opinions";
import { evaluatePublicationCandidate } from "@/modules/publication/domain/publication-policy";
import { FEDERAL_PUBLICATION_RULE_VERSION } from "../domain/federal-stream";
import { matchesBulkFederalJurisdiction } from "./ingest-courtlistener-bulk-federal-dockets";
import {
  BULK_DOCKET_DISK_FLOOR,
  BULK_DOCKET_LOAD_PAUSE_MS,
  BULK_DOCKET_MAX_PAUSES,
  csvField,
  freeDiskRatio,
  isEasternQuietWindow,
  rowsPerHour,
  shouldPauseForLoad,
} from "./bulk-docket-load";
import { CASE_PUBLICATION_CANDIDATE } from "./write-bulk-opinion-graph";
import {
  bulkContentHash,
  bulkOpinionPlainText,
  bulkOpinionSourceUri,
  bulkOpinionWordCount,
  normalizeBulkOpinionType,
  type CourtListenerBulkOpinion,
} from "../providers/courtlistener/bulk-opinions";

type Sql = ReturnType<typeof postgres>;

/** Opinions per merge. Text is large, so chunks are also capped by bytes. */
export const BULK_OPINION_CHUNK_ROWS = 1_000;
export const BULK_OPINION_CHUNK_BYTES = 32 * 1024 * 1024;
/** Reason recorded on holds so the federal and cited publishers leave bulk text draft. */
export const BULK_OPINION_HOLD_REASON = "bulk_opinion_text_pending_review";
export const BULK_OPINION_LANE = "federal-bulk-opinions";

/** Text columns are stored in document_content; keep them out of provider_metadata. */
const TEXT_COLUMNS = ["html_with_citations", "html_columbia", "html_lawbox", "html", "xml_harvard", "plain_text"];

export interface BulkOpinionCheckpoint {
  version: 1;
  snapshotDate: string;
  rowsConsumed: number;
  merged: number;
  alreadyPresent: number;
  unmatched: number;
  nonFederal: number;
  empty: number;
  stopped: string | null;
}

export function emptyBulkOpinionCheckpoint(snapshotDate: string): BulkOpinionCheckpoint {
  return { version: 1, snapshotDate, rowsConsumed: 0, merged: 0, alreadyPresent: 0, unmatched: 0, nonFederal: 0, empty: 0, stopped: null };
}

export function decodeBulkOpinionCheckpoint(value: string | null, snapshotDate: string): BulkOpinionCheckpoint {
  if (!value) return emptyBulkOpinionCheckpoint(snapshotDate);
  const parsed = JSON.parse(value) as Partial<BulkOpinionCheckpoint>;
  if (parsed.version !== 1 || parsed.snapshotDate !== snapshotDate || typeof parsed.rowsConsumed !== "number") {
    return emptyBulkOpinionCheckpoint(snapshotDate);
  }
  const base = emptyBulkOpinionCheckpoint(snapshotDate);
  return {
    ...base,
    rowsConsumed: parsed.rowsConsumed,
    merged: parsed.merged ?? 0,
    alreadyPresent: parsed.alreadyPresent ?? 0,
    unmatched: parsed.unmatched ?? 0,
    nonFederal: parsed.nonFederal ?? 0,
    empty: parsed.empty ?? 0,
    // `stopped` describes the previous run; a new run starts clear.
    stopped: null,
  };
}

export function bulkOpinionStreamName(snapshotDate: string): string {
  return `courtlistener:bulk-opinions:v1:${snapshotDate}`;
}

/** The facts of an existing cluster -> legal_case -> court an opinion attaches to. */
export interface OpinionClusterMatch {
  providerClusterId: string;
  clusterId: string;
  caseId: string;
  courtId: string;
  courtCode: string;
  jurisdiction: string | null;
  caseName: string;
  caseIsDraft: boolean;
  dateFiled: string | null;
  precedentialStatus: string | null;
  citationCount: number;
}

/** Federal only: no SCOTUS (official pipeline) and no bankruptcy courts. */
export function isFederalOpinionCourt(courtCode: string, jurisdiction: string | null): boolean {
  if (courtCode.trim().toLowerCase() === "scotus") return false;
  return matchesBulkFederalJurisdiction(jurisdiction, false);
}

export interface StagedOpinion {
  opinionId: string;
  providerClusterId: string;
  clusterId: string;
  caseId: string;
  courtId: string;
  courtName: string;
  caseName: string;
  caseIsDraft: boolean;
  dateFiled: string | null;
  precedentialStatus: string | null;
  citationCount: number;
  opinionType: string;
  title: string;
  authorName: string | null;
  perCuriam: boolean;
  downloadUrl: string | null;
  contentHtml: string;
  contentText: string;
  contentHash: string;
  extractionMethod: string;
  wordCount: number;
  documentPublicId: string;
  sourceUri: string;
  providerMetadata: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/** Same field derivation as writeBulkOpinionGraph, so both paths store identical rows. */
export function stageOpinion(
  opinion: CourtListenerBulkOpinion,
  match: OpinionClusterMatch,
  snapshotDate: string,
): StagedOpinion | null {
  const extracted = bulkOpinionPlainText(opinion);
  const contentText = extracted.text.trim();
  if (!contentText) return null;
  const opinionType = normalizeBulkOpinionType(opinion.type);
  const contentHtml = extracted.html ?? `<p>${escapeHtml(contentText)}</p>`;
  const metadata: Record<string, unknown> = { ...opinion };
  for (const column of TEXT_COLUMNS) delete metadata[column];
  return {
    opinionId: opinion.id,
    providerClusterId: opinion.cluster_id,
    clusterId: match.clusterId,
    caseId: match.caseId,
    courtId: match.courtId,
    courtName: match.courtCode.toUpperCase(),
    caseName: match.caseName,
    caseIsDraft: match.caseIsDraft,
    dateFiled: match.dateFiled,
    precedentialStatus: match.precedentialStatus,
    citationCount: match.citationCount,
    opinionType,
    title: `${match.caseName} — ${opinionType}`,
    authorName: opinion.author_str || null,
    perCuriam: opinion.per_curiam ?? false,
    downloadUrl: opinion.download_url || null,
    contentHtml,
    contentText,
    contentHash: bulkContentHash(contentHtml),
    extractionMethod: extracted.method,
    wordCount: bulkOpinionWordCount(contentText),
    documentPublicId: createPublicId("document"),
    sourceUri: bulkOpinionSourceUri(snapshotDate, opinion.id),
    providerMetadata: JSON.stringify(metadata),
  };
}

/** Postgres text cannot hold NUL; CourtListener OCR text occasionally has it. */
function pgText(value: string | null): string | null {
  return value === null ? null : value.replaceAll("\u0000", "");
}

export function opinionStageCsv(rows: readonly StagedOpinion[]): string {
  return rows.map((row) => [
    row.opinionId, row.providerClusterId, row.clusterId, row.caseId, row.courtId, row.courtName,
    row.caseName, row.caseIsDraft ? "t" : "f", row.dateFiled, row.precedentialStatus, String(row.citationCount),
    row.opinionType, row.title, row.authorName, row.perCuriam ? "t" : "f", row.downloadUrl,
    row.contentHtml, row.contentText, row.contentHash, row.extractionMethod, String(row.wordCount),
    row.documentPublicId, row.sourceUri, row.providerMetadata,
  ].map((value) => csvField(pgText(value))).join(",")).join("\n") + (rows.length ? "\n" : "");
}

export interface OpinionMergeCounts {
  inserted: number;
  documentsHeld: number;
  casesHeld: number;
}

/**
 * Set-based merge of one staged chunk. Only NEW opinions are written (an opinion
 * already in judicial_opinion is left exactly as it is, published or not). Every new
 * document is draft and gets a citation_publication_hold, and every draft case gets a
 * federal_publication_hold, both under the publishers' current rule versions, so
 * neither automatic publisher promotes bulk text without review.
 */
export async function mergeOpinionStage(
  sql: Sql,
  providerId: string,
  snapshotDate: string,
  rows: readonly StagedOpinion[],
): Promise<OpinionMergeCounts> {
  await sql`TRUNCATE courtlistener_opinion_stage`;
  if (!rows.length) return { inserted: 0, documentsHeld: 0, casesHeld: 0 };
  const copy = sql.unsafe(
    "COPY courtlistener_opinion_stage (opinion_id, provider_cluster_id, cluster_id, case_id, court_id, court_name, case_name, case_is_draft, date_filed, precedential_status, citation_count, opinion_type, title, author_name, per_curiam, download_url, content_html, content_text, content_hash, extraction_method, word_count, document_public_id, source_uri, provider_metadata) FROM STDIN WITH (FORMAT csv, NULL '\\N')",
  );
  const stream = await copy.writable();
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", () => resolve());
    stream.end(opinionStageCsv(rows));
  });
  const preflight = evaluatePublicationCandidate(CASE_PUBLICATION_CANDIDATE);
  const reviewStatus = preflight.recommendation === "reject" ? "rejected" : "pending";
  const objectPrefix = `courtlistener/bulk/opinions-${snapshotDate}.csv.bz2#`;
  const artifactMeta = { source: "courtlistener_bulk", snapshotDate, lane: BULK_OPINION_LANE, objectStored: false };

  return sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '170s', true)`;
    // Rows whose opinion already exists (written by another path since the prefilter) are dropped here.
    await tx`
      DELETE FROM courtlistener_opinion_stage stage
      USING judicial_opinion existing
      WHERE existing.provider_id = ${providerId} AND existing.provider_opinion_id = stage.opinion_id
    `;
    const [counts] = await tx<{ inserted: number; documents_held: number; cases_held: number }[]>`
      WITH artifact AS (
        INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key, media_type, retrieved_at, response_metadata)
        SELECT ${providerId}, stage.source_uri, stage.opinion_id, stage.content_hash,
          ${objectPrefix} || stage.opinion_id, 'text/csv', ${snapshotDate}::timestamptz, ${tx.json(artifactMeta)}
        FROM courtlistener_opinion_stage stage
        ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id, source_record_id
      ), created AS (
        INSERT INTO document (public_id, case_id, document_type, title, filed_on, content_hash, source_artifact_id, publication, extraction_confidence)
        SELECT stage.document_public_id, stage.case_id, 'judicial_opinion', stage.title, stage.date_filed,
          stage.content_hash, artifact.id, 'draft', 1.000
        FROM courtlistener_opinion_stage stage
        JOIN artifact ON artifact.source_record_id = stage.opinion_id
        RETURNING id, public_id, source_artifact_id
      ), opinion AS (
        INSERT INTO judicial_opinion (cluster_id, document_id, provider_id, provider_opinion_id, opinion_type, author_name, per_curiam, source_download_url, source_artifact_id, provider_metadata)
        SELECT stage.cluster_id, created.id, ${providerId}, stage.opinion_id, stage.opinion_type, stage.author_name,
          stage.per_curiam, stage.download_url, created.source_artifact_id, stage.provider_metadata
        FROM created JOIN courtlistener_opinion_stage stage ON stage.document_public_id = created.public_id
        RETURNING document_id
      ), identifier AS (
        INSERT INTO document_identifier (document_id, provider_id, identifier_type, identifier_value)
        SELECT created.id, ${providerId}, 'courtlistener_opinion_id', stage.opinion_id
        FROM created JOIN courtlistener_opinion_stage stage ON stage.document_public_id = created.public_id
        ON CONFLICT (provider_id, identifier_type, identifier_value) DO NOTHING
        RETURNING document_id
      ), content AS (
        INSERT INTO document_content (document_id, content_html, content_text, content_hash, extraction_method, word_count, source_artifact_id)
        SELECT created.id, stage.content_html, stage.content_text, stage.content_hash, stage.extraction_method,
          stage.word_count, created.source_artifact_id
        FROM created JOIN courtlistener_opinion_stage stage ON stage.document_public_id = created.public_id
        RETURNING document_id
      ), projection AS (
        INSERT INTO opinion_search_projection (document_id, case_id, court_id, cluster_id, title, case_caption, court_name, date_filed, precedential_status, opinion_type, citation_count, body)
        SELECT created.id, stage.case_id, stage.court_id, stage.cluster_id, stage.title, stage.case_name, stage.court_name,
          stage.date_filed, stage.precedential_status, stage.opinion_type, stage.citation_count, stage.content_text
        FROM created JOIN courtlistener_opinion_stage stage ON stage.document_public_id = created.public_id
        RETURNING document_id
      ), document_hold AS (
        INSERT INTO citation_publication_hold (document_id, content_hash, reasons, rule_version)
        SELECT created.id, stage.content_hash, ARRAY[${BULK_OPINION_HOLD_REASON}]::text[], ${CITED_OPINION_RULE_VERSION}
        FROM created JOIN courtlistener_opinion_stage stage ON stage.document_public_id = created.public_id
        ON CONFLICT (document_id) DO NOTHING
        RETURNING document_id
      ), case_hold AS (
        INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
        SELECT DISTINCT stage.case_id, ARRAY[${BULK_OPINION_HOLD_REASON}]::text[], ${FEDERAL_PUBLICATION_RULE_VERSION}
        FROM courtlistener_opinion_stage stage
        WHERE stage.case_is_draft
        ON CONFLICT (case_id) DO UPDATE SET
          reasons = ARRAY(SELECT DISTINCT reason FROM unnest(federal_publication_hold.reasons || EXCLUDED.reasons) reason ORDER BY reason),
          rule_version = EXCLUDED.rule_version,
          held_at = now()
        RETURNING case_id
      ), review AS (
        INSERT INTO publication_review (object_type, object_id, status, requested_by_type, preflight_version, risk_flags, evidence, reviewed_at)
        SELECT 'document', created.id, ${reviewStatus}, 'system', ${preflight.version}, ${tx.json(preflight.reasons)},
          jsonb_build_array(jsonb_build_object('provider', 'courtlistener', 'opinionId', stage.opinion_id,
            'clusterId', stage.provider_cluster_id, 'source', 'courtlistener_bulk')),
          ${reviewStatus === "rejected" ? new Date().toISOString() : null}
        FROM created JOIN courtlistener_opinion_stage stage ON stage.document_public_id = created.public_id
        ON CONFLICT (object_type, object_id) WHERE status IN ('pending', 'in_review', 'needs_changes') DO NOTHING
        RETURNING object_id
      )
      SELECT
        (SELECT count(*)::int FROM opinion) AS inserted,
        (SELECT count(*)::int FROM document_hold) AS documents_held,
        (SELECT count(*)::int FROM case_hold) AS cases_held,
        (SELECT count(*)::int FROM identifier) + (SELECT count(*)::int FROM content)
          + (SELECT count(*)::int FROM projection) + (SELECT count(*)::int FROM review) AS side_rows
    `;
    return {
      inserted: counts?.inserted ?? 0,
      documentsHeld: counts?.documents_held ?? 0,
      casesHeld: counts?.cases_held ?? 0,
    };
  });
}

export interface BulkOpinionLoadOptions {
  opinions: AsyncIterable<CourtListenerBulkOpinion>;
  snapshotDate: string;
  /** Opinions to merge in this run. */
  rowLimit: number;
  budgetMs: number;
  allowAnytime?: boolean;
  resetCheckpoint?: boolean;
  chunkRows?: number;
  chunkBytes?: number;
  /** Directory whose filesystem must keep 30% free (the database volume's host disk). */
  diskPath: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

export interface BulkOpinionLoadResult extends BulkOpinionCheckpoint {
  resumedFromRow: number;
  rowsReadThisRun: number;
  mergedThisRun: number;
  documentsHeld: number;
  casesHeld: number;
  elapsedMs: number;
  rowsReadPerSecond: number;
  mergedPerHour: number;
  freeDiskRatio: number | null;
  pauses: number;
}

interface Pending {
  opinion: CourtListenerBulkOpinion;
  bytes: number;
}

function opinionBytes(opinion: CourtListenerBulkOpinion): number {
  return opinion.plain_text.length + opinion.html_with_citations.length + opinion.html_columbia.length
    + opinion.html_lawbox.length + opinion.html.length + opinion.xml_harvard.length;
}

export async function loadCourtListenerBulkOpinions(sql: Sql, options: BulkOpinionLoadOptions): Promise<BulkOpinionLoadResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  if (!Number.isInteger(options.rowLimit) || options.rowLimit < 1) throw new Error("--row-limit must be a positive integer");
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));
  const chunkRows = options.chunkRows ?? BULK_OPINION_CHUNK_ROWS;
  const chunkBytes = options.chunkBytes ?? BULK_OPINION_CHUNK_BYTES;
  const started = now();
  const deadline = started + options.budgetMs;

  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const streamName = bulkOpinionStreamName(options.snapshotDate);
  const [stored] = await sql<{ cursor_value: string }[]>`
    SELECT cursor_value FROM ingestion_checkpoint WHERE provider_id = ${provider.id} AND stream_name = ${streamName}
  `;
  let checkpoint = options.resetCheckpoint
    ? emptyBulkOpinionCheckpoint(options.snapshotDate)
    : decodeBulkOpinionCheckpoint(stored?.cursor_value ?? null, options.snapshotDate);
  const initial = checkpoint;
  let rowsSeen = 0;
  let pauses = 0;
  let freeRatio: number | null = null;
  let documentsHeld = 0;
  let casesHeld = 0;
  const batch: Pending[] = [];
  let batchBytes = 0;

  const save = async (next: BulkOpinionCheckpoint) => {
    checkpoint = next;
    await sql`
      INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
      VALUES (${provider.id}, ${streamName}, ${JSON.stringify(checkpoint)})
      ON CONFLICT (provider_id, stream_name) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
    `;
  };
  const finish = (): BulkOpinionLoadResult => {
    const elapsedMs = now() - started;
    const rowsReadThisRun = Math.max(0, checkpoint.rowsConsumed - initial.rowsConsumed);
    const mergedThisRun = checkpoint.merged - initial.merged;
    return {
      ...checkpoint,
      resumedFromRow: initial.rowsConsumed,
      rowsReadThisRun,
      mergedThisRun,
      documentsHeld,
      casesHeld,
      elapsedMs,
      rowsReadPerSecond: elapsedMs > 0 ? Math.round((rowsReadThisRun * 1000) / elapsedMs) : 0,
      mergedPerHour: rowsPerHour(mergedThisRun, elapsedMs),
      freeDiskRatio: freeRatio,
      pauses,
    };
  };

  if (!options.allowAnytime && !isEasternQuietWindow(new Date())) {
    await save({ ...checkpoint, stopped: "outside-quiet-window" });
    return finish();
  }

  /** Gate, then merge the pending batch. Returns a stop reason, or null to continue. */
  const flush = async (): Promise<string | null> => {
    const gate = await gateChunk(sql, options.diskPath, options.sleep);
    pauses += gate.pauses;
    freeRatio = gate.freeDiskRatio;
    if (gate.stop) return gate.stop;
    if (!options.allowAnytime && !isEasternQuietWindow(new Date())) return "outside-quiet-window";
    if (now() >= deadline) return "budget";

    const opinions = batch.map((pending) => pending.opinion);
    const matches = await lookupClusters(sql, provider.id, [...new Set(opinions.map((opinion) => opinion.cluster_id))]);
    const existing = new Set((await sql<{ id: string }[]>`
      SELECT provider_opinion_id AS id FROM judicial_opinion
      WHERE provider_id = ${provider.id} AND provider_opinion_id = ANY(${opinions.map((opinion) => opinion.id)}::text[])
    `).map((row) => row.id));
    const staged: StagedOpinion[] = [];
    let unmatched = 0;
    let nonFederal = 0;
    let empty = 0;
    let alreadyPresent = 0;
    const seen = new Set<string>();
    for (const opinion of opinions) {
      if (seen.has(opinion.id)) { alreadyPresent += 1; continue; }
      seen.add(opinion.id);
      const match = matches.get(opinion.cluster_id);
      if (!match) { unmatched += 1; continue; }
      if (!isFederalOpinionCourt(match.courtCode, match.jurisdiction)) { nonFederal += 1; continue; }
      if (existing.has(opinion.id)) { alreadyPresent += 1; continue; }
      const row = stageOpinion(opinion, match, options.snapshotDate);
      if (!row) { empty += 1; continue; }
      staged.push(row);
    }
    const merged = await mergeOpinionStage(sql, provider.id, options.snapshotDate, staged);
    documentsHeld += merged.documentsHeld;
    casesHeld += merged.casesHeld;
    await save({
      ...checkpoint,
      rowsConsumed: rowsSeen,
      merged: checkpoint.merged + merged.inserted,
      alreadyPresent: checkpoint.alreadyPresent + alreadyPresent + (staged.length - merged.inserted),
      unmatched: checkpoint.unmatched + unmatched,
      nonFederal: checkpoint.nonFederal + nonFederal,
      empty: checkpoint.empty + empty,
      stopped: null,
    });
    log({ bulkOpinions: "chunk", ...checkpoint, mergedThisRun: checkpoint.merged - initial.merged, elapsedMs: now() - started });
    batch.length = 0;
    batchBytes = 0;
    return null;
  };

  let stop: string | null = null;
  for await (const opinion of options.opinions) {
    if (now() >= deadline) { stop = "budget"; break; }
    rowsSeen += 1;
    if (rowsSeen <= initial.rowsConsumed) continue;
    const bytes = opinionBytes(opinion);
    batch.push({ opinion, bytes });
    batchBytes += bytes;
    if (batch.length >= chunkRows || batchBytes >= chunkBytes) {
      stop = await flush();
      if (stop) break;
      if (checkpoint.merged - initial.merged >= options.rowLimit) { stop = "row-limit"; break; }
    }
  }
  if (!stop && batch.length) {
    stop = await flush();
    if (!stop && checkpoint.merged - initial.merged >= options.rowLimit) stop = "row-limit";
  }
  // A stop keeps rowsConsumed at the last merged chunk, so unmerged rows are read again.
  await save({ ...checkpoint, stopped: stop ?? "complete", rowsConsumed: stop ? checkpoint.rowsConsumed : rowsSeen });
  return finish();
}

async function lookupClusters(sql: Sql, providerId: string, clusterIds: string[]): Promise<Map<string, OpinionClusterMatch>> {
  if (!clusterIds.length) return new Map();
  const rows = await sql<OpinionClusterMatch[]>`
    SELECT
      opinion_cluster.provider_cluster_id AS "providerClusterId",
      opinion_cluster.id AS "clusterId",
      opinion_cluster.case_id AS "caseId",
      legal_case.court_id AS "courtId",
      coalesce(court.provider_court_id, '') AS "courtCode",
      court.jurisdiction AS "jurisdiction",
      opinion_cluster.case_name AS "caseName",
      (legal_case.publication = 'draft') AS "caseIsDraft",
      opinion_cluster.date_filed::text AS "dateFiled",
      opinion_cluster.precedential_status AS "precedentialStatus",
      opinion_cluster.citation_count AS "citationCount"
    FROM opinion_cluster
    JOIN legal_case ON legal_case.id = opinion_cluster.case_id
    JOIN court ON court.id = legal_case.court_id
    WHERE opinion_cluster.provider_id = ${providerId}
      AND opinion_cluster.provider_cluster_id = ANY(${clusterIds}::text[])
  `;
  return new Map(rows.map((row) => [row.providerClusterId, row]));
}

async function gateChunk(
  sql: Sql,
  diskPath: string,
  sleep: ((ms: number) => Promise<void>) | undefined,
): Promise<{ stop: string | null; pauses: number; freeDiskRatio: number | null }> {
  let pauses = 0;
  for (;;) {
    const disk = await statfs(diskPath).catch(() => null);
    const ratio = disk ? freeDiskRatio(disk.blocks, disk.bavail) : null;
    if (ratio === null || ratio < BULK_DOCKET_DISK_FLOOR) return { stop: "disk", pauses, freeDiskRatio: ratio };
    const [load] = await sql<{ slow: number }[]>`
      SELECT count(*)::int AS slow
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND application_name IN ('jurvio-web', 'jurvio-search')
        AND now() - query_start > interval '2 seconds'
        AND pid <> pg_backend_pid()
    `;
    const pause = shouldPauseForLoad({ loadAverage: os.loadavg()[0] ?? 0, cpuCount: os.cpus().length, slowPublicQueries: load?.slow ?? 0 });
    if (!pause) return { stop: null, pauses, freeDiskRatio: ratio };
    pauses += 1;
    if (pauses > BULK_DOCKET_MAX_PAUSES) return { stop: "paused", pauses, freeDiskRatio: ratio };
    console.log(JSON.stringify({ bulkOpinions: "pause", pauses, slowPublicQueries: load?.slow ?? 0 }));
    await (sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(BULK_DOCKET_LOAD_PAUSE_MS);
  }
}
