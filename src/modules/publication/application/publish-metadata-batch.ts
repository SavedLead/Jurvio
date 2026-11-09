/**
 * Publishes draft federal cases that have a caption and docket number, in
 * short committed batches. Opinion text, a source checksum, and a verified
 * court row are not required. Sealed text and a second case with the same
 * docket in the same court stay draft. The case row's update time is left
 * alone, so a history row does not look like a new filing to follower alerts.
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
  collisions: number;
}

export async function publishMetadataBatch(sql: Sql, options: { limit: number }): Promise<MetadataBatchStats> {
  const target = Math.min(5000, Math.max(0, Math.floor(options.limit)));
  const stats: MetadataBatchStats = { published: 0, scanned: 0, held: 0, heldByReason: {} };
  while (stats.scanned < target && stats.published < target) {
    try {
      const chunk = await publishChunk(sql, Math.min(CHUNK, target - stats.scanned));
      stats.published += chunk.published;
      stats.scanned += chunk.scanned;
      stats.held += chunk.sealed + chunk.collisions;
      if (chunk.sealed) stats.heldByReason.restricted_or_sensitive = (stats.heldByReason.restricted_or_sensitive ?? 0) + chunk.sealed;
      if (chunk.collisions) stats.heldByReason.duplicate_identity_collision = (stats.heldByReason.duplicate_identity_collision ?? 0) + chunk.collisions;
      if (chunk.scanned === 0) break;
    } catch (error) {
      if (stats.scanned > 0) return stats;
      throw error;
    }
  }
  return stats;
}

async function publishChunk(sql: Sql, limit: number): Promise<ChunkStats> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '20s'`;
    const [row] = await tx<{ published: number; scanned: number; sealed: number; collisions: number }[]>`
      WITH picked AS (
        SELECT c.id, c.court_id, c.docket_number,
          (concat_ws(' ', c.caption, c.docket_number) ~* ${RESTRICTED}) AS sealed
        FROM legal_case c
        JOIN court ON court.id = c.court_id
        WHERE c.publication = 'draft'
          AND lower(coalesce(court.provider_court_id, '')) <> 'scotus'
          AND length(btrim(c.caption)) > 0
          AND length(btrim(c.docket_number)) > 0
          AND (
            lower(coalesce(court.jurisdiction, '')) IN ('f', 'fd', 'fb', 'fbp', 'fs', 'federal')
            OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal district%'
            OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal appellate%'
            OR lower(coalesce(court.jurisdiction, '')) LIKE '%bankruptcy%'
            OR lower(coalesce(court.jurisdiction, '')) LIKE '%federal special%'
            OR court.verification = 'verified'
          )
          AND NOT EXISTS (
            SELECT 1 FROM federal_publication_hold hold
            WHERE hold.case_id = c.id
              AND hold.rule_version = ${RULE}
              AND NOT (${tx.unsafe(metadataHoldReopenSql())})
          )
        ORDER BY c.created_at
        LIMIT ${limit}
      ),
      marked AS (
        SELECT picked.id, picked.sealed,
          EXISTS (
            SELECT 1 FROM legal_case other
            WHERE other.court_id = picked.court_id
              AND other.id <> picked.id
              AND nullif(lower(regexp_replace(other.docket_number, '[^a-zA-Z0-9]', '', 'g')), '') IS NOT NULL
              AND lower(regexp_replace(other.docket_number, '[^a-zA-Z0-9]', '', 'g'))
                = lower(regexp_replace(picked.docket_number, '[^a-zA-Z0-9]', '', 'g'))
          ) AS collision
        FROM picked
      ),
      updated AS (
        UPDATE legal_case AS c
        SET verification = 'verified', publication = 'published'
        FROM marked
        WHERE c.id = marked.id AND NOT marked.sealed AND NOT marked.collision AND c.publication = 'draft'
        RETURNING c.id
      ),
      decided AS (
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        )
        SELECT 'legal_case', id, true, false, true, false, false, ${REASON}, ${RULE}
        FROM updated
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
        SELECT marked.id,
          CASE WHEN marked.sealed THEN ARRAY['restricted_or_sensitive']::text[]
            ELSE ARRAY['duplicate_identity_collision']::text[] END,
          ${RULE}
        FROM marked
        WHERE marked.sealed OR marked.collision
        ON CONFLICT (case_id) DO UPDATE SET
          reasons = EXCLUDED.reasons, rule_version = EXCLUDED.rule_version, held_at = now()
        RETURNING case_id
      )
      SELECT
        (SELECT count(*)::int FROM updated) AS published,
        (SELECT count(*)::int FROM picked) AS scanned,
        (SELECT count(*)::int FROM marked WHERE sealed) AS sealed,
        (SELECT count(*)::int FROM marked WHERE collision AND NOT sealed) AS collisions`;
    return {
      published: row?.published ?? 0,
      scanned: row?.scanned ?? 0,
      sealed: row?.sealed ?? 0,
      collisions: row?.collisions ?? 0,
    };
  });
}
