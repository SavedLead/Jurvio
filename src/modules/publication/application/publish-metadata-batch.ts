/**
 * Publishes one bounded slice of draft cases per commit. The slice is a fixed
 * window of legal_case_draft_created_idx, not a walk that continues until
 * 5,000 rows match. A saved cursor resumes the next window. Cases filed after
 * that cursor are taken before the older backlog. The first statement timeout
 * ends the cycle instead of starting another scan.
 *
 * Sealed captions stay draft. A federal_publication_hold that is not one of
 * the metadata waivers stays in force, including identity and collision holds.
 * The case row's update time is left alone, so history does not look like a
 * new filing to follower alerts.
 */
import type postgres from "postgres";
import { FEDERAL_PUBLICATION_RULE_VERSION } from "@/modules/ingestion/domain/federal-stream";
import { metadataHoldReopenSql } from "@/modules/ingestion/domain/federal-publication-hold";

type Sql = ReturnType<typeof postgres>;
type Queryable = Sql | Awaited<ReturnType<Sql["reserve"]>>;

const RULE = FEDERAL_PUBLICATION_RULE_VERSION;
const REASON = "metadata_batch_without_opinion_text";
/** POSIX twin of isRestrictedDocketText. */
const RESTRICTED = String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`;
/** Rows read from the draft index per statement. Filters run after this limit. */
export const DRAFT_WINDOW_SIZE = 500;
const CURSOR_STREAM = "metadata-publish-draft-window";
const PUBLISH_LOCK = "jurvio-metadata-publish-window";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
type Tier = "opinion" | "docket" | "record";
type WindowMode = "newest" | "after" | "before";

function tierPredicate(tier: Tier): string {
  if (tier === "opinion") {
    return `EXISTS (
      SELECT 1 FROM document d
      JOIN document_content content ON content.document_id = d.id
      WHERE d.case_id = c.id AND length(btrim(content.content_text)) > 40
    )`;
  }
  if (tier === "docket") {
    return "EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = c.id)";
  }
  return `(
    length(btrim(c.caption)) > 0
    OR length(btrim(c.docket_number)) > 0
    OR c.filed_on IS NOT NULL
    OR nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL
    OR nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL
  )`;
}

export interface DraftWindowCursor {
  highCreatedAt: string;
  highId: string;
  frontierCreatedAt: string;
  frontierId: string;
}

/** One checkpoint: the newest row already considered, and the oldest. */
export function encodeDraftCursor(cursor: DraftWindowCursor): string {
  return [cursor.highCreatedAt, cursor.highId, cursor.frontierCreatedAt, cursor.frontierId].join("|");
}

export function decodeDraftCursor(value: string | null | undefined): DraftWindowCursor | null {
  if (!value) return null;
  const [highCreatedAt, highId, frontierCreatedAt, frontierId] = value.split("|");
  if (!highCreatedAt || !highId || !frontierCreatedAt || !frontierId) return null;
  if (!ISO.test(highCreatedAt) || !ISO.test(frontierCreatedAt)) return null;
  if (!UUID.test(highId) || !UUID.test(frontierId)) return null;
  return { highCreatedAt, highId, frontierCreatedAt, frontierId };
}

/** A timeout ends the cycle. An empty window ends it too. Another slice must not start. */
export function publishCycleShouldStop(slice: { scanned: number; heldByReason: Record<string, number> }): boolean {
  return (slice.heldByReason.query_timeout ?? 0) > 0 || slice.scanned === 0;
}

export function isStatementTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === "57014") return true;
    const message = current instanceof Error ? current.message : "";
    if (/statement timeout/i.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface MetadataBatchStats {
  published: number;
  scanned: number;
  held: number;
  heldByReason: Record<string, number>;
}

interface WindowStats {
  published: number;
  scanned: number;
  sealed: number;
  timedOut: boolean;
}

interface WindowRow {
  published: number;
  scanned: number;
  sealed: number;
  newest_at: Date | string | null;
  newest_id: string | null;
  oldest_at: Date | string | null;
  oldest_id: string | null;
}

export async function publishMetadataBatch(sql: Sql, options: { limit: number }): Promise<MetadataBatchStats> {
  const target = Math.min(5000, Math.max(0, Math.floor(options.limit)));
  const stats: MetadataBatchStats = { published: 0, scanned: 0, held: 0, heldByReason: {} };
  const windowSize = Math.min(DRAFT_WINDOW_SIZE, Math.max(1, target));
  while (stats.published < target && stats.scanned < target) {
    const window = await publishDraftWindow(sql, windowSize);
    if (window.timedOut) {
      stats.heldByReason.query_timeout = 1;
      break;
    }
    stats.published += window.published;
    stats.scanned += window.scanned;
    stats.held += window.sealed;
    if (window.sealed) {
      stats.heldByReason.restricted_or_sensitive = (stats.heldByReason.restricted_or_sensitive ?? 0) + window.sealed;
    }
    if (publishCycleShouldStop({ scanned: window.scanned, heldByReason: stats.heldByReason })) break;
  }
  return stats;
}

/**
 * One commit of at most `limit` draft rows, and never more than DRAFT_WINDOW_SIZE.
 * The index limit runs before sealed, court, and hold filters.
 */
export async function publishMetadataSlice(sql: Queryable, limit: number): Promise<MetadataBatchStats> {
  const windowSize = Math.min(DRAFT_WINDOW_SIZE, Math.max(1, Math.floor(limit)));
  const window = await publishDraftWindow(sql, windowSize);
  if (window.timedOut) {
    return { published: 0, scanned: 0, held: 0, heldByReason: { query_timeout: 1 } };
  }
  return {
    published: window.published,
    scanned: window.scanned,
    held: window.sealed,
    heldByReason: window.sealed ? { restricted_or_sensitive: window.sealed } : {},
  };
}

async function publishDraftWindow(sql: Queryable, windowSize: number): Promise<WindowStats> {
  const cursor = await readDraftCursor(sql);
  if (cursor) {
    const newer = await commitDraftWindow(sql, "after", cursor, windowSize);
    if (newer.timedOut || newer.scanned > 0) return newer;
    return commitDraftWindow(sql, "before", cursor, windowSize);
  }
  return commitDraftWindow(sql, "newest", null, windowSize);
}

async function readDraftCursor(sql: Queryable): Promise<DraftWindowCursor | null> {
  const [stored] = await sql<{ cursor_value: string }[]>`
    SELECT checkpoint.cursor_value
    FROM ingestion_checkpoint checkpoint
    JOIN provider ON provider.id = checkpoint.provider_id
    WHERE provider.code = 'courtlistener' AND checkpoint.stream_name = ${CURSOR_STREAM}
  `;
  return decodeDraftCursor(stored?.cursor_value ?? null);
}

async function commitDraftWindow(
  sql: Queryable,
  mode: WindowMode,
  cursor: DraftWindowCursor | null,
  windowSize: number,
): Promise<WindowStats> {
  const limit = Math.trunc(windowSize);
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = '20s'`);
      await tx`SELECT set_config('jurvio.defer_search_refresh', 'on', true)`;
      const [provider] = await tx<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
      if (!provider) throw new Error("courtlistener provider is missing");
      const parameters = mode === "newest"
        ? [limit, RESTRICTED, RULE, REASON]
        : cursorParameters(mode, cursor, limit);
      const [row] = await tx.unsafe<WindowRow[]>(draftWindowSql(mode), parameters);
      const published = row?.published ?? 0;
      const scanned = row?.scanned ?? 0;
      const sealed = row?.sealed ?? 0;
      if (scanned > 0 && row?.newest_id && row.oldest_id && row.newest_at && row.oldest_at) {
        const next = nextDraftCursor(mode, cursor, {
          newestAt: isoTimestamp(row.newest_at),
          newestId: row.newest_id,
          oldestAt: isoTimestamp(row.oldest_at),
          oldestId: row.oldest_id,
        });
        const value = encodeDraftCursor(next);
        await tx`
          INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
          VALUES (${provider.id}, ${CURSOR_STREAM}, ${value})
          ON CONFLICT (provider_id, stream_name)
          DO UPDATE SET cursor_value = EXCLUDED.cursor_value
        `;
      }
      return { published, scanned, sealed, timedOut: false };
    });
  } catch (error) {
    if (isStatementTimeout(error)) {
      return { published: 0, scanned: 0, sealed: 0, timedOut: true };
    }
    throw error;
  }
}

function cursorParameters(mode: "after" | "before", cursor: DraftWindowCursor | null, limit: number): Array<string | number> {
  if (!cursor) throw new Error("draft window cursor is missing");
  const createdAt = mode === "after" ? cursor.highCreatedAt : cursor.frontierCreatedAt;
  const id = mode === "after" ? cursor.highId : cursor.frontierId;
  return [createdAt, id, limit, RESTRICTED, RULE, REASON];
}

function isoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("draft window cursor timestamp is invalid");
  return date.toISOString();
}

function nextDraftCursor(
  mode: WindowMode,
  cursor: DraftWindowCursor | null,
  ends: { newestAt: string; newestId: string; oldestAt: string; oldestId: string },
): DraftWindowCursor {
  if (mode === "before" && cursor) {
    return {
      highCreatedAt: cursor.highCreatedAt,
      highId: cursor.highId,
      frontierCreatedAt: ends.oldestAt,
      frontierId: ends.oldestId,
    };
  }
  if (mode === "after" && cursor) {
    return {
      highCreatedAt: ends.newestAt,
      highId: ends.newestId,
      frontierCreatedAt: cursor.frontierCreatedAt,
      frontierId: cursor.frontierId,
    };
  }
  return {
    highCreatedAt: ends.newestAt,
    highId: ends.newestId,
    frontierCreatedAt: ends.oldestAt,
    frontierId: ends.oldestId,
  };
}

/**
 * legal_case_draft_created_idx is (created_at, id) WHERE publication = 'draft'.
 * The MATERIALIZED window reads LIMIT rows from that index and stops.
 * Sealed captions, court, and identity holds are applied to that window only.
 */
function draftWindowSql(mode: WindowMode): string {
  const window = mode === "newest"
    ? `SELECT c.id, c.created_at
       FROM legal_case c
       WHERE c.publication = 'draft'
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $1`
    : mode === "after"
      ? `SELECT c.id, c.created_at
         FROM legal_case c
         WHERE c.publication = 'draft'
           AND (c.created_at, c.id) > ($1::timestamptz, $2::uuid)
         ORDER BY c.created_at ASC, c.id ASC
         LIMIT $3`
      : `SELECT c.id, c.created_at
         FROM legal_case c
         WHERE c.publication = 'draft'
           AND (c.created_at, c.id) < ($1::timestamptz, $2::uuid)
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT $3`;
  const restricted = mode === "newest" ? "$2" : "$4";
  const rule = mode === "newest" ? "$3" : "$5";
  const reason = mode === "newest" ? "$4" : "$6";
  return `
    WITH draft_publish_window AS MATERIALIZED (
      ${window}
    ),
    picked AS (
      SELECT c.id,
        (concat_ws(' ', c.caption, c.docket_number) ~* ${restricted}) AS sealed
      FROM draft_publish_window w
      JOIN legal_case c ON c.id = w.id
      JOIN court ON court.id = c.court_id
      WHERE c.publication = 'draft'
        AND lower(coalesce(court.provider_court_id, '')) <> 'scotus'
        AND (
          ${tierPredicate("record")}
          OR ${tierPredicate("docket")}
          OR ${tierPredicate("opinion")}
        )
        AND NOT EXISTS (
          SELECT 1 FROM federal_publication_hold hold
          WHERE hold.case_id = c.id
            AND hold.rule_version = ${rule}
            AND NOT (${metadataHoldReopenSql()})
        )
    ),
    updated AS (
      UPDATE legal_case AS c
      SET verification = 'verified', publication = 'published'
      FROM picked
      WHERE c.id = picked.id AND NOT picked.sealed AND c.publication = 'draft'
      RETURNING c.id
    ),
    decided AS (
      INSERT INTO publication_decision (
        object_type, object_id, displayable, indexable, machine_accessible,
        downloadable, summary_eligible, reason_code, rule_version
      )
      SELECT 'legal_case', id, true, false, true, false, false, ${reason}, ${rule}
      FROM updated
      RETURNING id, object_id, decided_at
    ),
    mirrored AS (
      INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
      SELECT 'legal_case', object_id, true, decided_at, id FROM decided
      ON CONFLICT (object_type, object_id) DO UPDATE SET
        displayable = EXCLUDED.displayable,
        decided_at = EXCLUDED.decided_at,
        decision_id = EXCLUDED.decision_id
      RETURNING object_id
    ),
    cleared AS (
      DELETE FROM federal_publication_hold AS hold
      USING updated
      WHERE hold.case_id = updated.id
      RETURNING hold.case_id
    ),
    held AS (
      INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
      SELECT picked.id, ARRAY['restricted_or_sensitive']::text[], ${rule}
      FROM picked
      WHERE picked.sealed
      ON CONFLICT (case_id) DO UPDATE SET
        reasons = EXCLUDED.reasons, rule_version = EXCLUDED.rule_version, held_at = now()
      RETURNING case_id
    )
    SELECT
      (SELECT count(*)::int FROM updated) AS published,
      (SELECT count(*)::int FROM draft_publish_window) AS scanned,
      (SELECT count(*)::int FROM picked WHERE sealed) AS sealed,
      (SELECT created_at FROM draft_publish_window ORDER BY created_at DESC, id DESC LIMIT 1) AS newest_at,
      (SELECT id FROM draft_publish_window ORDER BY created_at DESC, id DESC LIMIT 1) AS newest_id,
      (SELECT created_at FROM draft_publish_window ORDER BY created_at ASC, id ASC LIMIT 1) AS oldest_at,
      (SELECT id FROM draft_publish_window ORDER BY created_at ASC, id ASC LIMIT 1) AS oldest_id
  `;
}

export interface AdaptivePublishStats extends MetadataBatchStats {
  batchSize: number;
  searchMs: number | null;
  casePageMs: number | null;
  slowQueries: number;
  lockWaits: number;
  elapsedMs: number;
  stopped: string | null;
}

/** Keep committing bounded windows until the budget, an empty index range, or the first statement timeout. */
export async function runAdaptiveMetadataPublish(
  sql: Sql,
  options: { budgetMs: number; startBatch?: number },
): Promise<AdaptivePublishStats> {
  const { nextPublishBatch } = await import("../domain/continuous-publish");
  const { lockWaitCount, measurePublicSearchMs, medianMs, slowPublicQueryCount } = await import("./search-pace");
  const deadline = Date.now() + Math.max(15_000, options.budgetMs);
  let batch = 5_000;
  const stats: AdaptivePublishStats = {
    published: 0, scanned: 0, held: 0, heldByReason: {}, batchSize: batch,
    searchMs: null, casePageMs: null, slowQueries: 0, lockWaits: 0, elapsedMs: 0,
    stopped: null,
  };
  const started = Date.now();
  const reserved = await sql.reserve();
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${PUBLISH_LOCK})) AS locked
    `;
    if (!lock?.locked) {
      stats.heldByReason.overlapping_pass = 1;
      stats.stopped = "overlapping";
      stats.elapsedMs = Date.now() - started;
      return stats;
    }
    try {
      const searches: Array<number | null> = [];
      let failures = 0;
      while (Date.now() < deadline) {
        const searchMs = await measurePublicSearchMs();
        const casePageMs = await measurePublicSearchMs("https://jurvio.com/case/jv-c7mxm55hg0");
        searches.push(searchMs);
        const slowQueries = await slowPublicQueryCount(sql).catch(() => 0);
        const lockWaits = await lockWaitCount(sql).catch(() => 0);
        const pace = { searchMs: medianMs(searches), casePageMs, slowQueries, lockWaits };
        stats.searchMs = pace.searchMs;
        stats.casePageMs = casePageMs;
        stats.slowQueries = slowQueries;
        stats.lockWaits = lockWaits;
        const probeFailed = searchMs === null || casePageMs === null;
        failures = probeFailed ? failures + 1 : 0;
        batch = nextPublishBatch(batch, pace, failures);
        stats.batchSize = batch;
        if (batch === 0) {
          stats.stopped = "pace";
          break;
        }
        const slice = await publishMetadataSlice(reserved, batch);
        stats.published += slice.published;
        stats.scanned += slice.scanned;
        stats.held += slice.held;
        for (const [reason, count] of Object.entries(slice.heldByReason)) {
          stats.heldByReason[reason] = (stats.heldByReason[reason] ?? 0) + count;
        }
        if (publishCycleShouldStop(slice)) {
          stats.stopped = (slice.heldByReason.query_timeout ?? 0) > 0 ? "statement_timeout" : "end_of_drafts";
          break;
        }
      }
      if (!stats.stopped) stats.stopped = "budget";
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${PUBLISH_LOCK}))`;
    }
  } finally {
    stats.elapsedMs = Date.now() - started;
    reserved.release();
  }
  if (stats.published > 0) {
    const { refreshPublishedPages } = await import("@/lib/http/refresh-public-pages");
    void refreshPublishedPages().catch(() => undefined);
  }
  return stats;
}
