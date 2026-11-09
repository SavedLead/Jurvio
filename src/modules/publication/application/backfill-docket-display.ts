/**
 * One-time, paced backfill. Marks stored docket lines on published cases
 * displayable so a case page can list the initial filing, motions, and orders,
 * not only lines inserted in the last two days.
 *
 * Writes publication_decision only. Docket rows, follows, and alert cursors
 * stay as they are, so follower alerts still key off the original insert time.
 * Sealed text is left without a decision and stays hidden.
 */
import type postgres from "postgres";
import { FEDERAL_PUBLICATION_RULE_VERSION } from "@/modules/ingestion/domain/federal-stream";
import { docketDisplayBackfillEnabled, pacedPublishLimit } from "../domain/continuous-publish";
import { measurePublicSearchMs, slowPublicQueryCount } from "./search-pace";

type Sql = ReturnType<typeof postgres>;

const RULE = `${FEDERAL_PUBLICATION_RULE_VERSION}-docket-backfill`;
/** POSIX twin of isRestrictedDocketText. */
const RESTRICTED = String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`;
/** First passes prefer cases filed in this window, which includes current litigation. */
const RECENT_FILED_DAYS = 120;

export type DocketBackfillPhase = "recent" | "rest";

export interface DocketBackfillResult {
  skipped: "paused" | "search_slow" | null;
  shown: number;
  alertsQueued: 0;
  searchMs?: number | null;
  slowQueries?: number;
  phase?: DocketBackfillPhase;
  sampleCases?: string[];
}

export async function runDocketDisplayBackfill(
  sql: Sql,
  options: { limit?: number; phase?: DocketBackfillPhase } = {},
): Promise<DocketBackfillResult> {
  if (!docketDisplayBackfillEnabled()) {
    return { skipped: "paused", shown: 0, alertsQueued: 0 };
  }
  const requested = Math.min(3000, Math.max(1, options.limit ?? 2000));
  const searchMs = await measurePublicSearchMs();
  const slowQueries = await slowPublicQueryCount(sql).catch(() => 0);
  const limit = pacedPublishLimit(requested, searchMs, slowQueries);
  if (limit === 0) {
    return { skipped: "search_slow", shown: 0, alertsQueued: 0, searchMs, slowQueries };
  }
  const phase: DocketBackfillPhase = options.phase ?? "recent";
  const recent = phase === "recent";
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '8s'`;
    const [row] = await tx<{ shown: number; sampleCases: string[] | null }[]>`
      WITH picked AS (
        SELECT c.id
        FROM legal_case c
        WHERE c.publication = 'published'
          AND (${recent} = false OR c.filed_on >= current_date - ${RECENT_FILED_DAYS}::int)
          AND EXISTS (
            SELECT 1 FROM docket_entry e
            WHERE e.case_id = c.id
              AND e.description !~* ${RESTRICTED}
              AND NOT EXISTS (
                SELECT 1 FROM publication_decision d
                WHERE d.object_type = 'docket_entry' AND d.object_id = e.id
              )
          )
        ORDER BY c.filed_on DESC NULLS LAST
        LIMIT ${Math.min(250, limit)}
      ),
      inserted AS (
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        )
        SELECT
          'docket_entry', e.id, true, false, true, false, false,
          'docket_display_backfill', ${RULE}
        FROM docket_entry e
        JOIN picked ON picked.id = e.case_id
        WHERE e.description !~* ${RESTRICTED}
          AND NOT EXISTS (
            SELECT 1 FROM publication_decision d
            WHERE d.object_type = 'docket_entry' AND d.object_id = e.id
          )
        LIMIT ${limit}
        RETURNING object_id
      )
      SELECT count(*)::int AS shown,
        (
          SELECT array_agg(sample.public_id)
          FROM (
            SELECT DISTINCT c.public_id
            FROM inserted
            JOIN docket_entry e ON e.id = inserted.object_id
            JOIN legal_case c ON c.id = e.case_id
            ORDER BY c.public_id
            LIMIT 8
          ) sample
        ) AS "sampleCases"
      FROM inserted`;
    return {
      skipped: null,
      shown: row?.shown ?? 0,
      alertsQueued: 0 as const,
      searchMs,
      slowQueries,
      phase,
      sampleCases: row?.sampleCases ?? [],
    };
  });
}
