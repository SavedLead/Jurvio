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
}

export interface PublicScotusDiscovery {
  courtName: string;
  courtPublicId: string | null;
  opinionCount: number;
  caseCount: number;
  latestFiledOn: string | null;
  opinions: PublicScotusOpinionSummary[];
}

export async function listPublicScotusOpinions(
  sql: Sql,
  limit = 24,
): Promise<PublicScotusDiscovery> {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const [court] = await sql<Array<{ id: string; name: string; publicId: string }>>`
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

  if (!court) {
    return {
      courtName: "Supreme Court of the United States",
      courtPublicId: null,
      opinionCount: 0,
      caseCount: 0,
      latestFiledOn: null,
      opinions: [],
    };
  }

  const [totals, opinions] = await Promise.all([
    sql<Array<{ opinionCount: number; caseCount: number; latestFiledOn: string | null }>>`
      SELECT count(DISTINCT document.id)::int AS "opinionCount",
        count(DISTINCT legal_case.id)::int AS "caseCount",
        max(cluster.date_filed)::text AS "latestFiledOn"
      FROM legal_case
      JOIN document ON document.case_id = legal_case.id
      JOIN judicial_opinion judicial ON judicial.document_id = document.id
      JOIN opinion_cluster cluster ON cluster.id = judicial.cluster_id
      WHERE legal_case.court_id = ${court.id}
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
    `,
    sql<PublicScotusOpinionSummary[]>`
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
        content.word_count AS "wordCount"
      FROM legal_case
      JOIN document ON document.case_id = legal_case.id
      JOIN judicial_opinion judicial ON judicial.document_id = document.id
      JOIN opinion_cluster cluster ON cluster.id = judicial.cluster_id
      JOIN document_content content ON content.document_id = document.id
      WHERE legal_case.court_id = ${court.id}
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
      ORDER BY cluster.date_filed DESC NULLS LAST, cluster.citation_count DESC,
        legal_case.caption, judicial.opinion_type
      LIMIT ${boundedLimit}
    `,
  ]);

  return {
    courtName: court.name,
    courtPublicId: court.publicId,
    opinionCount: totals[0]?.opinionCount ?? 0,
    caseCount: totals[0]?.caseCount ?? 0,
    latestFiledOn: totals[0]?.latestFiledOn ?? null,
    opinions,
  };
}
