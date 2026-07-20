import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicationReviewQueueItem {
  id: string;
  objectType: string;
  objectId: string;
  status: string;
  riskFlags: unknown[];
  evidence: unknown[];
  createdAt: string;
}

export async function listPublicationReviewQueue(
  sql: Sql,
  limit = 100,
): Promise<PublicationReviewQueueItem[]> {
  return sql<PublicationReviewQueueItem[]>`
    SELECT id, object_type AS "objectType", object_id AS "objectId",
      status::text, risk_flags AS "riskFlags", evidence,
      created_at::text AS "createdAt"
    FROM publication_review
    WHERE status IN ('pending', 'needs_changes')
    ORDER BY created_at
    LIMIT ${limit}
  `;
}
