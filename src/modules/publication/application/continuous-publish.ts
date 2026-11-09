/**
 * Hourly publisher. Does nothing unless CONTINUOUS_PUBLISH=1 and the pause
 * flag is unset. Does not publish SCOTUS. Does not rewrite docket_entry rows,
 * so a history line cannot look like a new filing to follower alerts.
 * Metadata-only cases are displayable and not indexable.
 */
import type postgres from "postgres";
import { FEDERAL_PUBLICATION_RULE_VERSION, isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { continuousPublishEnabled, pacedPublishLimit } from "../domain/continuous-publish";
import { measurePublicSearchMs, slowPublicQueryCount } from "./search-pace";

type Sql = ReturnType<typeof postgres>;

const RULE = `${FEDERAL_PUBLICATION_RULE_VERSION}-continuous`;

export async function runContinuousPublish(sql: Sql, options: { limit?: number; now?: Date } = {}) {
  if (!continuousPublishEnabled()) {
    return { skipped: "off" as const, published: 0, held: 0, entriesShown: 0, alertsQueued: 0 as const };
  }
  const requested = Math.min(3000, Math.max(1, options.limit ?? 2000));
  const searchMs = await measurePublicSearchMs();
  const slowQueries = await slowPublicQueryCount(sql).catch(() => 0);
  const limit = pacedPublishLimit(requested, searchMs, slowQueries);
  if (limit === 0) {
    return { skipped: "search_slow" as const, published: 0, held: 0, entriesShown: 0, alertsQueued: 0 as const, searchMs, slowQueries };
  }
  const published = 0;
  const entriesShown = await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '8s'`;
    const entries = await tx<{ id: string; description: string }[]>`
      SELECT e.id::text, e.description
      FROM docket_entry e
      JOIN legal_case c ON c.id = e.case_id
      WHERE c.publication = 'published'
        AND e.created_at > now() - interval '2 days'
        AND NOT EXISTS (
          SELECT 1 FROM publication_decision d
          WHERE d.object_type = 'docket_entry' AND d.object_id = e.id
        )
      ORDER BY e.created_at DESC
      LIMIT ${limit}`;
    let entriesShown = 0;
    for (const entry of entries) {
      if (isRestrictedDocketText(entry.description)) continue;
      await tx`
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        ) VALUES (
          'docket_entry', ${entry.id}::uuid, true, false, true, false, false,
          'continuous_publish_entry', ${RULE}
        )`;
      entriesShown += 1;
    }
    return entriesShown;
  });
  return { skipped: null, published, held: 0, entriesShown, alertsQueued: 0 as const, searchMs, slowQueries };
}
