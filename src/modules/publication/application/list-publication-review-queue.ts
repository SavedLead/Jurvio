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
  label: string;
  publicId: string | null;
}

export async function listPublicationReviewQueue(
  sql: Sql,
  limit = 100,
): Promise<PublicationReviewQueueItem[]> {
  return sql<PublicationReviewQueueItem[]>`
    SELECT review.id, review.object_type AS "objectType", review.object_id AS "objectId",
      status::text, risk_flags AS "riskFlags", evidence,
      review.created_at::text AS "createdAt",
      COALESCE(legal_case.caption, document.title, entity.display_name, review.object_type) AS label,
      COALESCE(legal_case.public_id, document.public_id, entity.public_id) AS "publicId"
    FROM publication_review review
    LEFT JOIN legal_case ON review.object_type = 'legal_case' AND legal_case.id = review.object_id
    LEFT JOIN document ON review.object_type = 'document' AND document.id = review.object_id
    LEFT JOIN entity ON review.object_type = 'entity' AND entity.id = review.object_id
    WHERE review.status IN ('pending', 'needs_changes')
    ORDER BY review.created_at
    LIMIT ${limit}
  `;
}
