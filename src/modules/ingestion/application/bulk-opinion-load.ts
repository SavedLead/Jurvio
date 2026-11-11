import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { CITED_OPINION_RULE_VERSION } from "@/modules/citations/application/publish-cited-federal-opinions";
import { evaluatePublicationCandidate } from "@/modules/publication/domain/publication-policy";
import { matchesBulkFederalJurisdiction } from "./ingest-courtlistener-bulk-federal-dockets";
import { csvField, isEasternQuietWindow, rowsPerHour } from "./bulk-docket-load";
import { federalOpinionCourtIds, gateBulkChunk } from "./bulk-load-gate";
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
/** Reason recorded on the opinion document so cited publication leaves bulk text draft. */
export const BULK_OPINION_HOLD_REASON = "bulk_opinion_text_pending_review";
export const BULK_OPINION_LANE = "federal-bulk-opinions";

/** Text columns are stored in document_content; keep them out of provider_metadata. */
const TEXT_COLUMNS = ["html_with_citations", "html_columbia", "html_lawbox", "html", "xml_harvard", "plain_text"];

/** Unmatched rows skipped between checkpoint saves when nothing is being merged. */
export const BULK_OPINION_SKIP_SAVE_ROWS = 50_000;

/**
 * Version 2 (this PR). A version-1 checkpoint was written before clusters were
 * loaded, so the rows it "consumed" were mostly unmatched; it is ignored and the
 * snapshot is read again under a new stream name.
 *
 * A pass reads the whole file once, merging opinions whose cluster is in the
 * in-memory federal cluster set. When a pass completes and clusters were created
 * after it started (a later docket or cluster load resolved them), the next run
 * starts pass + 1, which only stages opinions of clusters created since the previous
 * pass started (`clustersSince`), so every other row is a fast skip.
 */
export interface BulkOpinionCheckpoint {
  version: 2;
  snapshotDate: string;
  pass: number;
  passStartedAt: string | null;
  clustersSince: string | null;
  rowsConsumed: number;
  merged: number;
  alreadyPresent: number;
  unmatched: number;
  nonFederal: number;
  empty: number;
  stopped: string | null;
}

export function emptyBulkOpinionCheckpoint(snapshotDate: string): BulkOpinionCheckpoint {
  return {
    version: 2, snapshotDate, pass: 1, passStartedAt: null, clustersSince: null,
    rowsConsumed: 0, merged: 0, alreadyPresent: 0, unmatched: 0, nonFederal: 0, empty: 0, stopped: null,
  };
}

/** Decodes the stored checkpoint, keeping `stopped` so a completed pass is recognized. */
export function decodeBulkOpinionCheckpoint(value: string | null, snapshotDate: string): BulkOpinionCheckpoint {
  if (!value) return emptyBulkOpinionCheckpoint(snapshotDate);
  const parsed = JSON.parse(value) as Partial<BulkOpinionCheckpoint> & { version?: number };
  if (parsed.version !== 2 || parsed.snapshotDate !== snapshotDate || typeof parsed.rowsConsumed !== "number") {
    return emptyBulkOpinionCheckpoint(snapshotDate);
  }
  const base = emptyBulkOpinionCheckpoint(snapshotDate);
  return {
    ...base,
    pass: parsed.pass ?? 1,
    passStartedAt: parsed.passStartedAt ?? null,
    clustersSince: parsed.clustersSince ?? null,
    rowsConsumed: parsed.rowsConsumed,
    merged: parsed.merged ?? 0,
    alreadyPresent: parsed.alreadyPresent ?? 0,
    unmatched: parsed.unmatched ?? 0,
    nonFederal: parsed.nonFederal ?? 0,
    empty: parsed.empty ?? 0,
    stopped: parsed.stopped ?? null,
  };
}

export function bulkOpinionStreamName(snapshotDate: string): string {
  return `courtlistener:bulk-opinions:v2:${snapshotDate}`;
}

/**
 * Sorted provider cluster ids, for an O(log n) membership test per opinion row.
 * A Float64Array of a few million ids is tens of MB; a Set of strings would be
 * several times that.
 */
export class ClusterIdSet {
  private readonly ids: Float64Array;

  constructor(values: Iterable<string>) {
    const numbers: number[] = [];
    for (const value of values) {
      if (/^\d{1,15}$/.test(value)) numbers.push(Number(value));
    }
    this.ids = Float64Array.from(numbers).sort();
  }

  get size(): number {
    return this.ids.length;
  }

  has(value: string): boolean {
    if (!/^\d{1,15}$/.test(value)) return false;
    const target = Number(value);
    let low = 0;
    let high = this.ids.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const current = this.ids[mid]!;
      if (current === target) return true;
      if (current < target) low = mid + 1;
      else high = mid - 1;
    }
    return false;
  }
}

/**
 * CourtListener cluster ids this snapshot can attach opinions to: clusters on a
 * federal (non-SCOTUS, non-bankruptcy) court whose case is draft or published
 * (restricted and suppressed cases get no text). With `since`, only clusters created
 * at or after it.
 */
export async function loadFederalClusterIds(
  sql: Sql,
  providerId: string,
  federalCourtIds: string[],
  since: string | null,
): Promise<ClusterIdSet> {
  const rows = await sql<{ id: string }[]>`
    SELECT opinion_cluster.provider_cluster_id AS id
    FROM opinion_cluster
    JOIN legal_case ON legal_case.id = opinion_cluster.case_id
    WHERE opinion_cluster.provider_id = ${providerId}
      AND legal_case.court_id = ANY(${federalCourtIds}::uuid[])
      AND legal_case.publication IN ('draft', 'published')
      AND (${since}::timestamptz IS NULL OR opinion_cluster.created_at >= ${since}::timestamptz)
  `;
  return new ClusterIdSet(rows.map((row) => row.id));
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
 * document is draft and gets a citation_publication_hold, so cited publication
 * does not promote bulk text without review. The case itself is not given
 * bulk_opinion_text_pending_review; that reason was blocking metadata publish.
 */
export async function mergeOpinionStage(
  sql: Sql,
  providerId: string,
  snapshotDate: string,
  rows: readonly StagedOpinion[],
): Promise<OpinionMergeCounts> {
  // TRUNCATE, COPY and merge share one transaction: TRUNCATE holds the stage's
  // ACCESS EXCLUSIVE lock until commit, so two loaders can never interleave on it.
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '170s', true)`;
    await tx`TRUNCATE courtlistener_opinion_stage`;
    if (!rows.length) return { inserted: 0, documentsHeld: 0, casesHeld: 0 };
    const copy = tx.unsafe(
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
        0 AS cases_held,
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
  /** Opened only when this run has rows to read (not for a finished snapshot). */
  openOpinions: () => AsyncIterable<CourtListenerBulkOpinion>;
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
  unmatchedThisRun: number;
  documentsHeld: number;
  casesHeld: number;
  clusterSetSize: number;
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
  const previousStop = checkpoint.stopped;
  checkpoint = { ...checkpoint, stopped: null };
  let initial = checkpoint;
  let rowsSeen = 0;
  let pauses = 0;
  let freeRatio: number | null = null;
  let documentsHeld = 0;
  let casesHeld = 0;
  let clusterSetSize = 0;
  /** Rows skipped since the last checkpoint save (not yet counted in the checkpoint). */
  let skippedSinceSave = 0;
  let unmatchedThisRun = 0;
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
      unmatchedThisRun,
      documentsHeld,
      casesHeld,
      clusterSetSize,
      elapsedMs,
      rowsReadPerSecond: elapsedMs > 0 ? Math.round((rowsReadThisRun * 1000) / elapsedMs) : 0,
      mergedPerHour: rowsPerHour(mergedThisRun, elapsedMs),
      freeDiskRatio: freeRatio,
      pauses,
    };
  };

  if (!options.allowAnytime && !isEasternQuietWindow(new Date())) {
    await save({ ...checkpoint, stopped: previousStop === "complete" ? "complete" : "outside-quiet-window" });
    return finish();
  }

  const federalCourtIds = await federalOpinionCourtIds(sql, provider.id, isFederalOpinionCourt);
  const [{ dbNow } = { dbNow: new Date().toISOString() }] = await sql<{ dbNow: string }[]>`SELECT now()::text AS "dbNow"`;

  if (previousStop === "complete") {
    // Start another pass only for clusters created after the finished pass began.
    const since = checkpoint.passStartedAt;
    const newer = since ? await loadFederalClusterIds(sql, provider.id, federalCourtIds, since) : new ClusterIdSet([]);
    if (newer.size === 0) {
      await save({ ...checkpoint, stopped: "complete" });
      return finish();
    }
    checkpoint = {
      ...checkpoint, pass: checkpoint.pass + 1, passStartedAt: null, clustersSince: since, rowsConsumed: 0, stopped: null,
    };
    initial = checkpoint;
    log({ bulkOpinions: "new-pass", pass: checkpoint.pass, clustersSince: since, newClusters: newer.size });
  }
  if (!checkpoint.passStartedAt) {
    checkpoint = { ...checkpoint, passStartedAt: dbNow };
    initial = { ...initial, passStartedAt: dbNow };
  }

  const clusterIds = await loadFederalClusterIds(sql, provider.id, federalCourtIds, checkpoint.clustersSince);
  clusterSetSize = clusterIds.size;
  log({ bulkOpinions: "cluster-set", pass: checkpoint.pass, clustersSince: checkpoint.clustersSince, clusters: clusterSetSize });
  if (clusterSetSize === 0) {
    // Nothing can match: reading the file would only burn the budget.
    await save({ ...checkpoint, stopped: "no-clusters" });
    return finish();
  }

  const saveSkips = async () => {
    await save({ ...checkpoint, rowsConsumed: rowsSeen, unmatched: checkpoint.unmatched + skippedSinceSave, stopped: null });
    skippedSinceSave = 0;
  };

  /** Gate, then merge the pending batch. Returns a stop reason, or null to continue. */
  const flush = async (): Promise<string | null> => {
    const gate = await gateBulkChunk(sql, options.diskPath, "bulkOpinions", options.sleep);
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
    unmatchedThisRun += skippedSinceSave + unmatched;
    await save({
      ...checkpoint,
      rowsConsumed: rowsSeen,
      merged: checkpoint.merged + merged.inserted,
      alreadyPresent: checkpoint.alreadyPresent + alreadyPresent + (staged.length - merged.inserted),
      unmatched: checkpoint.unmatched + skippedSinceSave + unmatched,
      nonFederal: checkpoint.nonFederal + nonFederal,
      empty: checkpoint.empty + empty,
      stopped: null,
    });
    skippedSinceSave = 0;
    log({ bulkOpinions: "chunk", ...checkpoint, mergedThisRun: checkpoint.merged - initial.merged, elapsedMs: now() - started });
    batch.length = 0;
    batchBytes = 0;
    return null;
  };

  let stop: string | null = null;
  let lastProgressLog = 0;
  for await (const opinion of options.openOpinions()) {
    if (now() >= deadline) { stop = "budget"; break; }
    rowsSeen += 1;
    if (rowsSeen <= initial.rowsConsumed) continue;
    if (!clusterIds.has(opinion.cluster_id)) {
      // Fast skip: no lookup, no staging. Saved periodically while nothing is batched,
      // so a stop never makes the next run re-read a long unmatched stretch.
      skippedSinceSave += 1;
      if (!batch.length && skippedSinceSave >= BULK_OPINION_SKIP_SAVE_ROWS) {
        if (!options.allowAnytime && !isEasternQuietWindow(new Date())) { stop = "outside-quiet-window"; break; }
        unmatchedThisRun += skippedSinceSave;
        await saveSkips();
        if (rowsSeen - lastProgressLog >= 500_000) {
          lastProgressLog = rowsSeen;
          log({ bulkOpinions: "skip", ...checkpoint, mergedThisRun: checkpoint.merged - initial.merged, elapsedMs: now() - started });
        }
      }
      continue;
    }
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
  if (!stop && skippedSinceSave) {
    unmatchedThisRun += skippedSinceSave;
    checkpoint = { ...checkpoint, unmatched: checkpoint.unmatched + skippedSinceSave };
    skippedSinceSave = 0;
  }
  // A stop keeps rowsConsumed at the last saved row, so unmerged rows are read again.
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
      AND legal_case.publication IN ('draft', 'published')
  `;
  return new Map(rows.map((row) => [row.providerClusterId, row]));
}
