import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface AgencySourceHealth {
  code: string; name: string; agencyKind: string; enabled: boolean; lastStatus: string | null; lastError: string | null;
  lastAttemptAt: string | null; lastSuccessAt: string | null; consecutiveFailures: number;
  items: number; items24h: number; linked: number; queued: number; restricted: number;
}

export interface QueuedAgencyItem {
  sourceCode: string; title: string; sourceUrl: string; publishedAt: string | null; restricted: boolean;
  restrictedReason: string | null; statedCourts: string[]; refs: Array<{ docket: string; court: string | null; status: string; note: string | null }>;
}

export async function getAgencySourceHealth(sql: Sql): Promise<AgencySourceHealth[]> {
  return sql<AgencySourceHealth[]>`
    SELECT source.code, source.name, source.agency_kind AS "agencyKind", source.enabled, source.last_status AS "lastStatus",
      source.last_error AS "lastError", source.last_attempt_at::text AS "lastAttemptAt", source.last_success_at::text AS "lastSuccessAt",
      source.consecutive_failures AS "consecutiveFailures",
      count(item.id)::int AS items,
      count(item.id) FILTER (WHERE item.first_seen_at > now() - interval '24 hours')::int AS "items24h",
      count(item.id) FILTER (WHERE item.review_status = 'linked')::int AS linked,
      count(item.id) FILTER (WHERE item.review_status = 'queued')::int AS queued,
      count(item.id) FILTER (WHERE item.restricted)::int AS restricted
    FROM agency_source source LEFT JOIN agency_source_item item ON item.source_code = source.code
    GROUP BY source.code ORDER BY source.agency_kind, source.code
  `;
}

/** The review queue: items that state a court reference Jurvio could not link, newest first. */
export async function listReviewQueue(sql: Sql, limit = 100): Promise<QueuedAgencyItem[]> {
  return sql<QueuedAgencyItem[]>`
    SELECT item.source_code AS "sourceCode", item.title, item.source_url AS "sourceUrl", item.published_at::text AS "publishedAt",
      item.restricted, item.restricted_reason AS "restrictedReason", item.stated_courts AS "statedCourts",
      coalesce(json_agg(json_build_object('docket', ref.docket_number, 'court', ref.court_code, 'status', ref.match_status, 'note', ref.match_note))
        FILTER (WHERE ref.id IS NOT NULL), '[]') AS refs
    FROM agency_source_item item LEFT JOIN agency_item_case_ref ref ON ref.item_id = item.id
    WHERE item.review_status = 'queued' AND (ref.id IS NOT NULL OR cardinality(item.stated_courts) > 0)
    GROUP BY item.id ORDER BY item.first_seen_at DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `;
}
