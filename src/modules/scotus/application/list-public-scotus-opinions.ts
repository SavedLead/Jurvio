import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { easternDate } from "@/modules/scotus/domain/emergency-application";
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
  /** False when the precomputed total did not load. The page must not print that as zero. */
  caseCountAvailable: boolean;
  latestFiledOn: string | null;
  opinions: PublicScotusOpinionSummary[];
}

const EMPTY_DISCOVERY: PublicScotusDiscovery = {
  courtName: "Supreme Court of the United States",
  courtPublicId: null,
  opinionCount: 0,
  caseCount: 0,
  caseCountAvailable: false,
  latestFiledOn: null,
  opinions: [],
};

function missingRelation(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "42P01" || code === "42703";
}

/**
 * Recent published opinions for one court.
 *
 * The case total is its own statement. A slow opinion read used to abort that
 * total and the page showed a corpus of zero. The opinion read uses
 * opinion_search_meta (court + date index, visibility already stored). A
 * missing meta table falls back to a short date window and
 * latestPublicationColumnSql, still under the statement timeout.
 */
export async function listPublicScotusOpinions(
  sql: Sql,
  limit = 24,
): Promise<PublicScotusDiscovery> {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const today = easternDate(new Date());
  try {
    const court = await sql.begin(async (tx) => {
      await tx`SELECT set_config('statement_timeout', '4s', true)`;
      const [row] = await tx<Array<{ id: string; name: string; publicId: string; caseCount: number | null }>>`
        SELECT court.id, court.name, court.public_id AS "publicId",
          (SELECT sum(stats.case_count)::int FROM court_public_stats stats WHERE stats.court_id = court.id) AS "caseCount"
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
      return row ?? null;
    });
    if (!court) return EMPTY_DISCOVERY;

    let opinions: PublicScotusOpinionSummary[] = [];
    try {
      opinions = await sql.begin((tx) => opinionsFromMeta(tx, court.id, today, boundedLimit));
    } catch (error) {
      if (!missingRelation(error) && (error as { code?: string }).code !== "57014") throw error;
    }
    if (!opinions.length) {
      try {
        opinions = await sql.begin((tx) => opinionsFromClusters(tx, court.id, today, boundedLimit));
      } catch {
        opinions = [];
      }
    }
    const visible = opinions.filter((opinion) => !isRestrictedDocketText(`${opinion.caseCaption} ${opinion.title}`));
    return {
      courtName: court.name,
      courtPublicId: court.publicId,
      opinionCount: visible.length,
      caseCount: court.caseCount ?? 0,
      caseCountAvailable: court.caseCount !== null,
      latestFiledOn: visible[0]?.filedOn ?? null,
      opinions: visible,
    };
  } catch {
    return EMPTY_DISCOVERY;
  }
}

async function opinionsFromMeta(
  tx: postgres.TransactionSql<Record<string, never>>,
  courtId: string,
  today: string,
  limit: number,
): Promise<PublicScotusOpinionSummary[]> {
  await tx`SELECT set_config('statement_timeout', '4s', true)`;
  return tx<PublicScotusOpinionSummary[]>`
    SELECT legal_case.public_id AS "casePublicId",
      document.public_id AS "documentPublicId",
      legal_case.caption AS "caseCaption",
      legal_case.docket_number AS "docketNumber",
      document.title,
      meta.date_filed::text AS "filedOn",
      judicial.opinion_type AS "opinionType",
      judicial.author_name AS "authorName",
      judicial.per_curiam AS "perCuriam",
      meta.precedential_status AS "precedentialStatus",
      meta.citation_count AS "citationCount",
      COALESCE(content.word_count, 0) AS "wordCount",
      judicial.source_download_url AS "sourceDownloadUrl"
    FROM opinion_search_meta meta
    JOIN document ON document.id = meta.document_id
    JOIN legal_case ON legal_case.id = meta.case_id
    JOIN judicial_opinion judicial ON judicial.document_id = document.id
    LEFT JOIN document_content content ON content.document_id = document.id
    WHERE meta.court_id = ${courtId}
      AND meta.visible
      AND legal_case.publication = 'published'
      AND document.publication = 'published'
      AND (meta.date_filed IS NULL OR meta.date_filed <= ${today}::date)
      AND NOT ${tx.unsafe(searchExcludedCaseSql("legal_case"))}
    ORDER BY meta.date_filed DESC NULLS LAST, meta.citation_count DESC,
      legal_case.caption, judicial.opinion_type
    LIMIT ${limit}
  `;
}

async function opinionsFromClusters(
  tx: postgres.TransactionSql<Record<string, never>>,
  courtId: string,
  today: string,
  limit: number,
): Promise<PublicScotusOpinionSummary[]> {
  await tx`SELECT set_config('statement_timeout', '4s', true)`;
  const caseDisplayable = tx.unsafe(latestPublicationColumnSql("displayable", "legal_case", "legal_case.id"));
  const documentDisplayable = tx.unsafe(latestPublicationColumnSql("displayable", "document", "document.id"));
  return tx<PublicScotusOpinionSummary[]>`
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
    WHERE legal_case.court_id = ${courtId}
      AND legal_case.publication = 'published'
      AND document.publication = 'published'
      AND cluster.date_filed >= ${today}::date - 400
      AND cluster.date_filed <= ${today}::date
      AND ${caseDisplayable}
      AND ${documentDisplayable}
      AND NOT ${tx.unsafe(searchExcludedCaseSql("legal_case"))}
    ORDER BY cluster.date_filed DESC NULLS LAST, cluster.citation_count DESC,
      legal_case.caption, judicial.opinion_type
    LIMIT ${limit}
  `;
}
