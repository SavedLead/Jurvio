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

/** Nov 9 check case. A public-id lookup, and a no-op once its lines have decisions. */
const CHECK_CASE_PUBLIC_ID = "jv-c7mxm55hg0";

export interface DocketBackfillResult {
  skipped: "paused" | "search_slow" | null;
  shown: number;
  scanned: number;
  alertsQueued: 0;
  searchMs?: number | null;
  slowQueries?: number;
  phase?: DocketBackfillPhase;
  sampleCases?: string[];
  cursorOn?: string | null;
  cursorId?: string | null;
}

export async function runDocketDisplayBackfill(
  sql: Sql,
  options: { limit?: number; phase?: DocketBackfillPhase; cursorOn?: string | null; cursorId?: string | null } = {},
): Promise<DocketBackfillResult> {
  if (!docketDisplayBackfillEnabled()) {
    return { skipped: "paused", shown: 0, scanned: 0, alertsQueued: 0 };
  }
  const requested = Math.min(3000, Math.max(1, options.limit ?? 2000));
  const searchMs = await measurePublicSearchMs();
  const slowQueries = await slowPublicQueryCount(sql).catch(() => 0);
  const limit = pacedPublishLimit(requested, searchMs, slowQueries);
  if (limit === 0) {
    return { skipped: "search_slow", shown: 0, scanned: 0, alertsQueued: 0, searchMs, slowQueries };
  }
  const phase: DocketBackfillPhase = options.phase ?? "recent";
  const recent = phase === "recent";
  const cursorOn = options.cursorOn ?? null;
  const cursorId = options.cursorId ?? null;
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '8s'`;
    // The published-recency index is (coalesce(decided_on, filed_on) desc, caption, id)
    // WHERE publication = 'published'. A short index walk avoids the previous
    // "find every case that still has an unmarked line" scan, which exceeded 8s.
    const [row] = await tx<{
      shown: number;
      scanned: number;
      sampleCases: string[] | null;
      cursorOn: string | null;
      cursorId: string | null;
    }[]>`
      WITH walk AS (
        SELECT c.id, c.public_id, coalesce(c.decided_on, c.filed_on) AS sort_on
        FROM legal_case c
        WHERE c.publication = 'published'
          AND (${recent} = false OR c.filed_on >= current_date - ${RECENT_FILED_DAYS}::int)
          AND (
            ${cursorOn}::date IS NULL
            OR coalesce(c.decided_on, c.filed_on) < ${cursorOn}::date
            OR (coalesce(c.decided_on, c.filed_on) = ${cursorOn}::date AND c.id < ${cursorId}::uuid)
          )
        ORDER BY coalesce(c.decided_on, c.filed_on) DESC NULLS LAST, c.id DESC
        LIMIT ${Math.min(60, limit)}
      ),
      picked AS (
        SELECT c.id, c.public_id, coalesce(c.decided_on, c.filed_on) AS sort_on
        FROM legal_case c
        WHERE c.publication = 'published' AND c.public_id = ${CHECK_CASE_PUBLIC_ID}
        UNION
        SELECT id, public_id, sort_on FROM walk
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
        ORDER BY (picked.public_id = ${CHECK_CASE_PUBLIC_ID}) DESC, e.filed_on
        LIMIT ${limit}
        RETURNING object_id
      ),
      edge AS (
        SELECT sort_on::text AS sort_on, id::text AS id
        FROM walk
        ORDER BY sort_on ASC NULLS LAST, id ASC
        LIMIT 1
      )
      SELECT
        (SELECT count(*)::int FROM inserted) AS shown,
        (SELECT count(*)::int FROM walk) AS scanned,
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
        ) AS "sampleCases",
        (SELECT sort_on FROM edge) AS "cursorOn",
        (SELECT id FROM edge) AS "cursorId"`;
    return {
      skipped: null,
      shown: row?.shown ?? 0,
      scanned: row?.scanned ?? 0,
      alertsQueued: 0 as const,
      searchMs,
      slowQueries,
      phase,
      sampleCases: row?.sampleCases ?? [],
      cursorOn: row?.cursorOn ?? null,
      cursorId: row?.cursorId ?? null,
    };
  });
}
