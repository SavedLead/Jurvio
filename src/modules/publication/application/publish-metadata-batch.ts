/**
 * Publishes draft cases that already have an opinion, a stored docket line,
 * or other case-record metadata. A full source record is not required.
 * Sealed captions stay draft. The case row's update time
 * is left alone, so history does not look like a new filing to follower alerts.
 *
 * Thickest first: opinion text, then any stored docket line, then the rest
 * of the case record. Each commit is a short slice so the speed guard's cap
 * can finish inside one cycle.
 */
import type postgres from "postgres";
import { FEDERAL_PUBLICATION_RULE_VERSION } from "@/modules/ingestion/domain/federal-stream";
import { metadataHoldReopenSql } from "@/modules/ingestion/domain/federal-publication-hold";

type Sql = ReturnType<typeof postgres>;

const RULE = FEDERAL_PUBLICATION_RULE_VERSION;
const REASON = "metadata_batch_without_opinion_text";
/** POSIX twin of isRestrictedDocketText. */
const RESTRICTED = String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`;
const CHUNK = 500;
type Tier = "opinion" | "docket" | "record";

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

export interface MetadataBatchStats {
  published: number;
  scanned: number;
  held: number;
  heldByReason: Record<string, number>;
}

interface ChunkStats {
  published: number;
  scanned: number;
  sealed: number;
}

export async function publishMetadataBatch(sql: Sql, options: { limit: number }): Promise<MetadataBatchStats> {
  const target = Math.min(5000, Math.max(0, Math.floor(options.limit)));
  const stats: MetadataBatchStats = { published: 0, scanned: 0, held: 0, heldByReason: {} };
  for (const tier of ["opinion", "docket", "record"] as const) {
    let tierScanned = 0;
    while (stats.published < target && tierScanned < target) {
      try {
        const chunk = await publishChunk(sql, Math.min(CHUNK, target - tierScanned), tier);
        stats.published += chunk.published;
        stats.scanned += chunk.scanned;
        tierScanned += chunk.scanned;
        stats.held += chunk.sealed;
        if (chunk.sealed) stats.heldByReason.restricted_or_sensitive = (stats.heldByReason.restricted_or_sensitive ?? 0) + chunk.sealed;
        if (chunk.scanned === 0) break;
      } catch {
        stats.heldByReason.query_timeout = (stats.heldByReason.query_timeout ?? 0) + 1;
        break;
      }
    }
  }
  return stats;
}

async function publishChunk(sql: Sql, limit: number, tier: Tier): Promise<ChunkStats> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '20s'`;
    await tx`SELECT set_config('jurvio.defer_search_refresh', 'on', true)`;
    const [row] = await tx<{ published: number; scanned: number; sealed: number }[]>`
      WITH picked AS (
        SELECT c.id,
          (concat_ws(' ', c.caption, c.docket_number) ~* ${RESTRICTED}) AS sealed
        FROM legal_case c
        JOIN court ON court.id = c.court_id
        WHERE c.publication = 'draft'
          AND lower(coalesce(court.provider_court_id, '')) <> 'scotus'
          AND ${tx.unsafe(tierPredicate(tier))}
          AND NOT EXISTS (
            SELECT 1 FROM federal_publication_hold hold
            WHERE hold.case_id = c.id
              AND hold.rule_version = ${RULE}
              AND NOT (${tx.unsafe(metadataHoldReopenSql())})
          )
        ORDER BY c.created_at
        LIMIT ${limit}
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
        SELECT 'legal_case', id, true, ${tier === "opinion"}, true, false, false, ${REASON}, ${RULE}
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
        SELECT picked.id, ARRAY['restricted_or_sensitive']::text[], ${RULE}
        FROM picked
        WHERE picked.sealed
        ON CONFLICT (case_id) DO UPDATE SET
          reasons = EXCLUDED.reasons, rule_version = EXCLUDED.rule_version, held_at = now()
        RETURNING case_id
      )
      SELECT
        (SELECT count(*)::int FROM updated) AS published,
        (SELECT count(*)::int FROM picked) AS scanned,
        (SELECT count(*)::int FROM picked WHERE sealed) AS sealed`;
    return {
      published: row?.published ?? 0,
      scanned: row?.scanned ?? 0,
      sealed: row?.sealed ?? 0,
    };
  });
}

export interface AdaptivePublishStats extends MetadataBatchStats {
  batchSize: number;
  searchMs: number | null;
  casePageMs: number | null;
  slowQueries: number;
  lockWaits: number;
  elapsedMs: number;
}

/** One short commit of the thickest tier that still has rows. */
export async function publishMetadataSlice(sql: Sql, limit: number): Promise<MetadataBatchStats> {
  const size = Math.min(2000, Math.max(1, Math.floor(limit)));
  for (const tier of ["opinion", "docket", "record"] as const) {
    try {
      const chunk = await publishChunk(sql, size, tier);
      if (chunk.scanned === 0) continue;
      return {
        published: chunk.published,
        scanned: chunk.scanned,
        held: chunk.sealed,
        heldByReason: chunk.sealed ? { restricted_or_sensitive: chunk.sealed } : {},
      };
    } catch {
      return { published: 0, scanned: 0, held: 0, heldByReason: { query_timeout: 1 } };
    }
  }
  return { published: 0, scanned: 0, held: 0, heldByReason: {} };
}

/** Keep committing while the site stays fast, until the time budget or the draft pool runs out. */
export async function runAdaptiveMetadataPublish(
  sql: Sql,
  options: { budgetMs: number; startBatch?: number },
): Promise<AdaptivePublishStats> {
  const { nextPublishBatch } = await import("../domain/continuous-publish");
  const { lockWaitCount, measurePublicSearchMs, medianMs, slowPublicQueryCount } = await import("./search-pace");
  const deadline = Date.now() + Math.max(15_000, options.budgetMs);
  let batch = Math.min(10_000, Math.max(400, options.startBatch ?? 500));
  const stats: AdaptivePublishStats = {
    published: 0, scanned: 0, held: 0, heldByReason: {}, batchSize: batch,
    searchMs: null, casePageMs: null, slowQueries: 0, lockWaits: 0, elapsedMs: 0,
  };
  const started = Date.now();
  const searches: Array<number | null> = [];
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
    batch = nextPublishBatch(batch, pace);
    stats.batchSize = batch;
    if (batch === 0) break;
    const slice = await publishMetadataSlice(sql, batch);
    stats.published += slice.published;
    stats.scanned += slice.scanned;
    stats.held += slice.held;
    for (const [reason, count] of Object.entries(slice.heldByReason)) {
      stats.heldByReason[reason] = (stats.heldByReason[reason] ?? 0) + count;
    }
    if (slice.scanned === 0 && !slice.heldByReason.query_timeout) break;
  }
  stats.elapsedMs = Date.now() - started;
  return stats;
}
