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

export async function publishMetadataBatch(sql: Sql, options: { limit: number }): Promise<number> {
  const target = Math.min(5000, Math.max(0, Math.floor(options.limit)));
  let published = 0;
  while (published < target) {
    try {
      const count = await publishChunk(sql, Math.min(CHUNK, target - published));
      published += count;
      if (count === 0) break;
    } catch (error) {
      if (published > 0) return published;
      throw error;
    }
  }
  return published;
}

async function publishChunk(sql: Sql, limit: number): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '20s'`;
    const [row] = await tx<{ published: number }[]>`
      WITH picked AS (
        SELECT c.id
        FROM legal_case c
        JOIN court ON court.id = c.court_id
        WHERE c.publication = 'draft'
          AND lower(coalesce(court.provider_court_id, '')) <> 'scotus'
          AND length(btrim(c.caption)) > 0
          AND length(btrim(c.docket_number)) > 0
          AND concat_ws(' ', c.caption, c.docket_number) !~* ${RESTRICTED}
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
          AND NOT EXISTS (
            SELECT 1 FROM legal_case other
            WHERE other.court_id = c.court_id
              AND other.id <> c.id
              AND nullif(lower(regexp_replace(other.docket_number, '[^a-zA-Z0-9]', '', 'g')), '') IS NOT NULL
              AND lower(regexp_replace(other.docket_number, '[^a-zA-Z0-9]', '', 'g'))
                = lower(regexp_replace(c.docket_number, '[^a-zA-Z0-9]', '', 'g'))
          )
        ORDER BY c.created_at
        LIMIT ${limit}
      ),
      updated AS (
        UPDATE legal_case AS c
        SET verification = 'verified', publication = 'published'
        FROM picked
        WHERE c.id = picked.id AND c.publication = 'draft'
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
      )
      SELECT count(*)::int AS published FROM updated`;
    return row?.published ?? 0;
  });
}
