import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface RecentlyUpdatedPublicCase {
  publicId: string;
  caption: string;
  docketNumber: string;
  courtName: string;
  activityDate: string;
  hasPublicDocument: boolean;
}

export async function listRecentlyUpdatedPublicCases(
  sql: Sql,
  limit = 6,
): Promise<RecentlyUpdatedPublicCase[]> {
  const safeLimit = Math.min(12, Math.max(1, limit));

  return sql<RecentlyUpdatedPublicCase[]>`
    SELECT legal_case.public_id AS "publicId",
      legal_case.caption,
      legal_case.docket_number AS "docketNumber",
      court.name AS "courtName",
      GREATEST(
        legal_case.updated_at,
        COALESCE(legal_case.source_updated_at, legal_case.updated_at),
        COALESCE((
          SELECT max(docket_entry.updated_at)
          FROM docket_entry
          WHERE docket_entry.case_id = legal_case.id
        ), legal_case.updated_at),
        COALESCE((
          SELECT max(document.updated_at)
          FROM document
          WHERE document.case_id = legal_case.id
            AND document.publication = 'published'
            AND COALESCE((
              SELECT decision.displayable
              FROM publication_decision decision
              WHERE decision.object_type = 'document'
                AND decision.object_id = document.id
              ORDER BY decision.decided_at DESC, decision.id DESC
              LIMIT 1
            ), false)
        ), legal_case.updated_at)
      )::text AS "activityDate",
      EXISTS (
        SELECT 1
        FROM document
        WHERE document.case_id = legal_case.id
          AND document.publication = 'published'
          AND COALESCE((
            SELECT decision.displayable
            FROM publication_decision decision
            WHERE decision.object_type = 'document'
              AND decision.object_id = document.id
            ORDER BY decision.decided_at DESC, decision.id DESC
            LIMIT 1
          ), false)
      ) AS "hasPublicDocument"
    FROM legal_case
    JOIN court ON court.id = legal_case.court_id
    WHERE legal_case.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable
        FROM publication_decision decision
        WHERE decision.object_type = 'legal_case'
          AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC
        LIMIT 1
      ), false)
    ORDER BY "activityDate" DESC, legal_case.id
    LIMIT ${safeLimit}
  `;
}
