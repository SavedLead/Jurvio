import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { TOPICS, topicMatchSql } from "@/modules/accounts/domain/topics";
import { emergencyFeedConditionSql } from "@/modules/scotus/domain/emergency-application";
import {
  CourtListenerDeadlineReached,
  CourtListenerRateLimited,
  setCourtListenerRequestPolicy,
} from "../providers/courtlistener/client";
import type { ArtifactStore } from "./artifact-store";
import { ingestCourtListenerDocket } from "./ingest-courtlistener-docket";
import { ingestOfficialScotusDockets } from "./ingest-official-scotus-dockets";

type Sql = ReturnType<typeof postgres>;

/** Direct case follows and emergency applications. */
export const CASE_REFRESH_MINUTES = 15;
/** Judge, court, party, and topic matches that are not themselves followed. */
export const GROUP_REFRESH_MINUTES = 30;
/** Newest cases kept per judge, court, party, or topic follow. */
export const GROUP_CASE_LIMIT = 25;
/** CourtListener calls per run: one docket, one entry page, one party page. */
export const REFRESH_BATCH = 6;

const ELIGIBLE = `(
  c.publication = 'published'
  AND ${latestPublicationColumnSql("displayable", "legal_case", "c.id")}
  AND c.caption !~* '\\m(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\\M'
  AND c.docket_number !~* '-(mj|gj|sw|sealed)-'
  AND NOT EXISTS (SELECT 1 FROM direct_court_event restricted_event
    WHERE restricted_event.case_id = c.id AND restricted_event.restricted)
)`;

export async function priorityTableReady(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ name: string | null }[]>`SELECT to_regclass('public.followed_item_priority')::text AS name`;
  return Boolean(row?.name);
}

/** Put one case at the front of the lane. No-op until migration 0210 is applied. */
export async function queueFollowedCase(sql: Sql, caseId: string): Promise<void> {
  if (!await priorityTableReady(sql)) return;
  await sql`
    INSERT INTO followed_item_priority (case_id, reasons, due_at)
    VALUES (${caseId}, ARRAY['case']::text[], now())
    ON CONFLICT (case_id) DO UPDATE SET
      reasons = ARRAY(SELECT DISTINCT unnest(followed_item_priority.reasons || EXCLUDED.reasons)),
      due_at = now(),
      updated_at = now()
  `;
}

/**
 * Rebuild the lane from every active follow. Free and paid follows are the
 * same list. Sealed cases stay out. Existing due times are kept so a rebuild
 * does not refetch a case that was just checked.
 */
export async function syncFollowedItemPriority(sql: Sql): Promise<{ cases: number }> {
  if (!await priorityTableReady(sql)) return { cases: 0 };
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    await db`CREATE TEMP TABLE followed_wanted (case_id uuid, reason text) ON COMMIT DROP`;
    await db`
      INSERT INTO followed_wanted (case_id, reason)
      SELECT f.case_id, 'case' FROM case_follow f
      JOIN legal_case c ON c.id = f.case_id
      WHERE ${db.unsafe(ELIGIBLE)}
    `;
    await db`
      INSERT INTO followed_wanted (case_id, reason)
      SELECT picked.id, 'judge'
      FROM entity_follow f
      JOIN judge ON judge.public_id = f.target_key
      JOIN LATERAL (
        SELECT c.id FROM judge_case_assignment a
        JOIN legal_case c ON c.id = a.case_id
        WHERE a.judge_id = judge.id AND ${db.unsafe(ELIGIBLE)}
        ORDER BY c.updated_at DESC
        LIMIT ${GROUP_CASE_LIMIT}
      ) picked ON true
      WHERE f.kind = 'judge'
    `;
    await db`
      INSERT INTO followed_wanted (case_id, reason)
      SELECT picked.id, 'court'
      FROM entity_follow f
      JOIN court ON court.public_id = f.target_key
      JOIN LATERAL (
        SELECT c.id FROM legal_case c
        WHERE c.court_id = court.id AND ${db.unsafe(ELIGIBLE)}
        ORDER BY c.updated_at DESC
        LIMIT ${GROUP_CASE_LIMIT}
      ) picked ON true
      WHERE f.kind = 'court'
    `;
    await db`
      INSERT INTO followed_wanted (case_id, reason)
      SELECT picked.id, 'party'
      FROM entity_follow f
      JOIN LATERAL (
        SELECT c.id FROM party_appearance appearance
        JOIN entity ON entity.id = appearance.entity_id
        JOIN legal_case c ON c.id = appearance.case_id
        WHERE entity.normalized_name = f.target_key AND ${db.unsafe(ELIGIBLE)}
        ORDER BY c.updated_at DESC
        LIMIT ${GROUP_CASE_LIMIT}
      ) picked ON true
      WHERE f.kind = 'party'
    `;
    await db`
      INSERT INTO followed_wanted (case_id, reason)
      SELECT a.case_id, 'emergency'
      FROM entity_follow f
      JOIN scotus_application a ON a.kind <> 'extension' AND a.source_lane = 'live'
      JOIN legal_case c ON c.id = a.case_id
      WHERE f.kind = 'emergency' AND ${db.unsafe(emergencyFeedConditionSql("a"))} AND ${db.unsafe(ELIGIBLE)}
    `;
    for (const topic of TOPICS) {
      await db`
        INSERT INTO followed_wanted (case_id, reason)
        SELECT c.id, 'topic'
        FROM entity_follow f
        JOIN legal_case c ON ${db.unsafe(topicMatchSql(topic, "c.nature_of_suit_code"))}
        WHERE f.kind = 'topic' AND f.target_key = ${topic.slug}
          AND ${db.unsafe(ELIGIBLE)}
        ORDER BY c.updated_at DESC
        LIMIT ${GROUP_CASE_LIMIT}
      `;
    }
    await db`
      INSERT INTO followed_item_priority (case_id, reasons, due_at)
      SELECT case_id, array_agg(DISTINCT reason), now()
      FROM followed_wanted
      GROUP BY case_id
      ON CONFLICT (case_id) DO UPDATE SET
        reasons = EXCLUDED.reasons,
        updated_at = now()
    `;
    await db`
      DELETE FROM followed_item_priority priority
      WHERE NOT EXISTS (SELECT 1 FROM followed_wanted wanted WHERE wanted.case_id = priority.case_id)
    `;
    const [row] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM followed_item_priority`;
    return { cases: row?.n ?? 0 };
  });
}

export interface FollowedRefreshSummary {
  claimed: number;
  refreshed: number;
  notModified: number;
  skipped: number;
  rateLimited: boolean;
}

/**
 * Refresh a few due followed cases from free sources. CourtListener stops on
 * the first 429. A new docket line is inserted once; an existing line keeps
 * its created_at, so a refresh does not email old filings.
 */
export async function refreshDueFollowedCases(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: { limit?: number; deadlineMs: number },
): Promise<FollowedRefreshSummary> {
  const summary: FollowedRefreshSummary = { claimed: 0, refreshed: 0, notModified: 0, skipped: 0, rateLimited: false };
  if (!await priorityTableReady(sql)) return summary;
  const limit = Math.min(REFRESH_BATCH, Math.max(1, options.limit ?? REFRESH_BATCH));
  const claimed = await sql.begin(async (tx) => {
    const rows = await tx<{ caseId: string; reasons: string[] }[]>`
      SELECT case_id AS "caseId", reasons
      FROM followed_item_priority
      WHERE due_at <= now()
      ORDER BY due_at, case_id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length > 0) {
      await tx`
        UPDATE followed_item_priority SET due_at = now() + interval '20 minutes'
        WHERE case_id IN ${tx(rows.map((row) => row.caseId))}
      `;
    }
    return rows;
  });
  summary.claimed = claimed.length;
  setCourtListenerRequestPolicy({ deadlineMs: options.deadlineMs, stopOnRateLimit: true });
  try {
    for (const row of claimed) {
      if (Date.now() >= options.deadlineMs) break;
      try {
        const outcome = await refreshOne(sql, artifactStore, row.caseId);
        if (outcome === "not_modified") summary.notModified += 1;
        else if (outcome === "refreshed") summary.refreshed += 1;
        else summary.skipped += 1;
        await sql`
          UPDATE followed_item_priority SET
            last_refresh_at = now(),
            last_error = NULL,
            due_at = now() + make_interval(mins => ${nextMinutes(row.reasons)}),
            updated_at = now()
          WHERE case_id = ${row.caseId}
        `;
      } catch (error) {
        if (error instanceof CourtListenerRateLimited || error instanceof CourtListenerDeadlineReached) {
          summary.rateLimited = true;
          const waitMinutes = error instanceof CourtListenerRateLimited && error.retryAfterMs
            ? Math.max(5, Math.ceil(error.retryAfterMs / 60_000))
            : 15;
          await sql`
            UPDATE followed_item_priority SET due_at = now() + make_interval(mins => ${waitMinutes}),
              last_error = 'rate_limited', updated_at = now()
            WHERE case_id = ${row.caseId}
          `;
          break;
        }
        const message = error instanceof Error ? error.message.slice(0, 300) : "refresh failed";
        await sql`
          UPDATE followed_item_priority SET last_error = ${message},
            due_at = now() + interval '30 minutes', updated_at = now()
          WHERE case_id = ${row.caseId}
        `;
      }
    }
  } finally {
    setCourtListenerRequestPolicy({});
  }
  return summary;
}

function nextMinutes(reasons: string[]): number {
  return reasons.includes("case") || reasons.includes("emergency") ? CASE_REFRESH_MINUTES : GROUP_REFRESH_MINUTES;
}

async function refreshOne(sql: Sql, artifactStore: ArtifactStore, caseId: string): Promise<"refreshed" | "not_modified" | "skipped"> {
  const [row] = await sql<{ docketNumber: string | null; courtCode: string | null; clId: string | null }[]>`
    SELECT c.docket_number AS "docketNumber", lower(court.provider_court_id) AS "courtCode",
      (SELECT identifier.identifier_value FROM case_identifier identifier
        WHERE identifier.case_id = c.id AND identifier.identifier_type = 'courtlistener_docket_id'
        LIMIT 1) AS "clId"
    FROM legal_case c
    JOIN court ON court.id = c.court_id
    WHERE c.id = ${caseId}
  `;
  if (!row) return "skipped";
  if (row.courtCode === "scotus" && row.docketNumber) {
    await ingestOfficialScotusDockets(sql, artifactStore, { limit: 1, caseId, skipPdfs: true });
    return "refreshed";
  }
  const docketId = Number(row.clId);
  if (!Number.isInteger(docketId) || docketId <= 0) return "skipped";
  const result = await ingestCourtListenerDocket(sql, artifactStore, docketId, {
    maximumEntryPages: 1,
    maximumPartyPages: 1,
    newestEntriesFirst: true,
  });
  return result.notModified ? "not_modified" : "refreshed";
}
