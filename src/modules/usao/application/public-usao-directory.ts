import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export type PublicUsaoOffice = {
  publicId: string;
  displayName: string;
  caseCount: number;
  activeCaseCount: number;
  latestCaseFiledOn: string | null;
  attorneyCount: number;
};

export async function listPublicUsaoOffices(sql: Sql): Promise<PublicUsaoOffice[]> {
  return sql<PublicUsaoOffice[]>`
    SELECT
      public_id AS "publicId",
      display_name AS "displayName",
      case_count AS "caseCount",
      active_case_count AS "activeCaseCount",
      latest_case_filed_on::text AS "latestCaseFiledOn",
      attorney_count AS "attorneyCount"
    FROM usao_office_analytics
    ORDER BY display_name
  `;
}
