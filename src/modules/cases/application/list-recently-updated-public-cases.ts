import type postgres from "postgres";
import { readableOpinionExistsSql } from "@/modules/cases/domain/readable-opinion";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";

type Sql = ReturnType<typeof postgres>;

export interface RecentlyUpdatedPublicCase {
  publicId: string;
  caption: string;
  docketNumber: string;
  courtName: string;
  activityDate: string;
  hasPublicDocument: boolean;
}

// Size of the candidate pool considered before computing the (relatively
// expensive) cross-table activity date. The homepage only ever shows a handful
// of cases, so ordering by the indexed legal_case.updated_at first and then
// computing the full activity date for just this many candidates keeps the
// query fast at scale. updated_at is a lower bound on the activity date
// (GREATEST includes it), so a generous pool comfortably covers the top rows.
const RECENT_CANDIDATE_POOL = 400;

export async function listRecentlyUpdatedPublicCases(
  sql: Sql,
  limit = 6,
): Promise<RecentlyUpdatedPublicCase[]> {
  const safeLimit = Math.min(12, Math.max(1, limit));

  // Two phase: (1) cheaply pick the most recently updated published+displayable
  // cases using the (publication, updated_at DESC) index, then (2) compute the
  // full activity date and document flag for only those candidates. Computing
  // the activity date for every published case and sorting all of them is what
  // made this query time out at production scale.
  return sql<RecentlyUpdatedPublicCase[]>`
    WITH candidate AS (
      SELECT legal_case.id
      FROM legal_case
      WHERE legal_case.publication = 'published'
        AND COALESCE((
          SELECT decision.displayable
          FROM publication_decision decision
          WHERE decision.object_type = 'legal_case'
            AND decision.object_id = legal_case.id
          ORDER BY decision.decided_at DESC, decision.id DESC
          LIMIT 1
        ), false)
        AND NOT ${sql.unsafe(searchExcludedCaseSql("legal_case"))}
      ORDER BY legal_case.updated_at DESC
      LIMIT ${RECENT_CANDIDATE_POOL}
    )
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
      ${sql.unsafe(readableOpinionExistsSql("legal_case"))} AS "hasPublicDocument"
    FROM candidate
    JOIN legal_case ON legal_case.id = candidate.id
    JOIN court ON court.id = legal_case.court_id
    ORDER BY "activityDate" DESC, legal_case.id
    LIMIT ${safeLimit}
  `;
}
