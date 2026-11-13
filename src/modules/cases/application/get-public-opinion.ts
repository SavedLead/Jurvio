import { redactPublicFields } from "@/modules/privacy/application/active-redactions";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicOpinion {
  casePublicId: string;
  documentPublicId: string;
  caseCaption: string;
  docketNumber: string;
  officialCitation: string | null;
  courtName: string;
  title: string;
  filedOn: string | null;
  opinionType: string;
  authorName: string | null;
  perCuriam: boolean;
  precedentialStatus: string | null;
  citations: unknown;
  citationCount: number;
  contentHtml: string;
  contentText: string;
  wordCount: number;
  sourceDownloadUrl: string | null;
  indexable: boolean;
  /** A name redaction changed text on this opinion. The page stays up and is not indexed. */
  redacted: boolean;
  /** Search-excluded (sealed-style) case: the opinion is shown only to paid subscribers. */
  subscriberOnly: boolean;
}

export async function getPublicOpinion(
  sql: Sql,
  casePublicId: string,
  documentPublicId: string,
): Promise<PublicOpinion | null> {
  const [record] = await sql<PublicOpinion[]>`
    SELECT
      legal_case.public_id AS "casePublicId",
      document.public_id AS "documentPublicId",
      legal_case.caption AS "caseCaption",
      legal_case.docket_number AS "docketNumber",
      legal_case.official_citation AS "officialCitation",
      court.name AS "courtName",
      document.title,
      document.filed_on::text AS "filedOn",
      judicial.opinion_type AS "opinionType",
      judicial.author_name AS "authorName",
      judicial.per_curiam AS "perCuriam",
      cluster.precedential_status AS "precedentialStatus",
      cluster.citations,
      COALESCE(cluster.citation_count, 0) AS "citationCount",
      COALESCE(content.content_html, '') AS "contentHtml",
      COALESCE(content.content_text, '') AS "contentText",
      COALESCE(content.word_count, 0) AS "wordCount",
      judicial.source_download_url AS "sourceDownloadUrl",
      -- A published opinion with no extracted text is still a real page (the
      -- official PDF). It is not a page for a search engine.
      COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
        AND COALESCE(content.word_count, 0) > 0
        AND NOT ${sql.unsafe(searchExcludedCaseSql("legal_case"))} AS indexable,
      ${sql.unsafe(searchExcludedCaseSql("legal_case"))} AS "subscriberOnly"
    FROM document
    JOIN legal_case ON legal_case.id = document.case_id
    JOIN court ON court.id = legal_case.court_id
    JOIN judicial_opinion judicial ON judicial.document_id = document.id
    JOIN opinion_cluster cluster ON cluster.id = judicial.cluster_id
    LEFT JOIN document_content content ON content.document_id = document.id
    WHERE legal_case.public_id = ${casePublicId}
      AND document.public_id = ${documentPublicId}
      AND legal_case.publication = 'published'
      AND document.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    LIMIT 1
  `;
  if (!record) return null;
  const redactedFields = await redactPublicFields(sql, record, ["caseCaption", "title", "authorName", "contentHtml", "contentText"]);
  return { ...redactedFields.record, redacted: redactedFields.changed };
}
