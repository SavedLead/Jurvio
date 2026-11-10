import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicScotusOpinionSummary {
  casePublicId: string;
  documentPublicId: string;
  caseCaption: string;
  docketNumber: string;
  title: string;
  filedOn: string | null;
  opinionType: string;
  authorName: string | null;
  perCuriam: boolean;
  precedentialStatus: string | null;
  citationCount: number;
  wordCount: number;
  sourceDownloadUrl: string | null;
}

export interface PublicScotusDiscovery {
  courtName: string;
  courtPublicId: string | null;
  opinionCount: number;
  caseCount: number;
  latestFiledOn: string | null;
  opinions: PublicScotusOpinionSummary[];
}

const EMPTY_DISCOVERY: PublicScotusDiscovery = {
  courtName: "Supreme Court of the United States",
  courtPublicId: null,
  opinionCount: 0,
  caseCount: 0,
  latestFiledOn: null,
  opinions: [],
};

export async function listPublicScotusOpinions(
  sql: Sql,
  limit = 24,
): Promise<PublicScotusDiscovery> {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  try {
    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('statement_timeout', '4s', true)`;
      const [court] = await tx<Array<{ id: string; name: string; publicId: string }>>`
        SELECT id, name, public_id AS "publicId"
        FROM court
        WHERE lower(COALESCE(provider_court_id, '')) = 'scotus'
          OR lower(name) IN (
            'supreme court of the united states',
            'u.s. supreme court',
            'supreme court of the us'
          )
        ORDER BY CASE WHEN lower(COALESCE(provider_court_id, '')) = 'scotus' THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 1
      `;
      if (!court) return EMPTY_DISCOVERY;

      const caseDisplayable = tx.unsafe(latestPublicationColumnSql("displayable", "legal_case", "legal_case.id"));
      const documentDisplayable = tx.unsafe(latestPublicationColumnSql("displayable", "document", "document.id"));
      const [stats] = await tx<Array<{ caseCount: number }>>`
        SELECT coalesce((
          SELECT sum(case_count) FROM court_public_stats WHERE court_id = ${court.id}
        ), 0)::int AS "caseCount"
      `;
      const opinions = await tx<PublicScotusOpinionSummary[]>`
        SELECT legal_case.public_id AS "casePublicId",
          document.public_id AS "documentPublicId",
          legal_case.caption AS "caseCaption",
          legal_case.docket_number AS "docketNumber",
          document.title,
          cluster.date_filed::text AS "filedOn",
          judicial.opinion_type AS "opinionType",
          judicial.author_name AS "authorName",
          judicial.per_curiam AS "perCuriam",
          cluster.precedential_status AS "precedentialStatus",
          cluster.citation_count AS "citationCount",
          COALESCE(content.word_count, 0) AS "wordCount",
          judicial.source_download_url AS "sourceDownloadUrl"
        FROM legal_case
        JOIN document ON document.case_id = legal_case.id
        JOIN judicial_opinion judicial ON judicial.document_id = document.id
        JOIN opinion_cluster cluster ON cluster.id = judicial.cluster_id
        LEFT JOIN document_content content ON content.document_id = document.id
        WHERE legal_case.court_id = ${court.id}
          AND legal_case.publication = 'published'
          AND document.publication = 'published'
          AND ${caseDisplayable}
          AND ${documentDisplayable}
          AND NOT ${tx.unsafe(searchExcludedCaseSql("legal_case"))}
        ORDER BY cluster.date_filed DESC NULLS LAST, cluster.citation_count DESC,
          legal_case.caption, judicial.opinion_type
        LIMIT ${boundedLimit}
      `;
      return {
        courtName: court.name,
        courtPublicId: court.publicId,
        opinionCount: opinions.length,
        caseCount: stats?.caseCount ?? 0,
        latestFiledOn: opinions[0]?.filedOn ?? null,
        opinions,
      };
    });
  } catch {
    return EMPTY_DISCOVERY;
  }
}
