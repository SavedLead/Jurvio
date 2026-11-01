import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicGovernmentLead {
  publicId: string;
  agencyCode: string;
  agencyName: string;
  sourceKind: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: string | null;
  attributedSummary: string;
  casePublicId: string | null;
  caseCaption: string | null;
  docketNumber: string | null;
}

const publicLeadSelect = `
  SELECT lead.public_id AS "publicId", source.agency AS "agencyCode", source.name AS "agencyName",
    source.source_kind AS "sourceKind", lead.source_title AS "sourceTitle", lead.source_url AS "sourceUrl",
    lead.source_published_at::text AS "sourcePublishedAt", lead.attributed_summary AS "attributedSummary",
    legal_case.public_id AS "casePublicId", legal_case.caption AS "caseCaption",
    legal_case.docket_number AS "docketNumber"
  FROM government_litigation_lead lead
  JOIN government_source source ON source.id = lead.government_source_id
  LEFT JOIN legal_case ON legal_case.id = lead.linked_case_id AND legal_case.publication = 'published'
    AND NOT ${searchExcludedCaseSql("legal_case")}
`;

export async function listPublicGovernmentLeads(sql: Sql, limit = 30): Promise<PublicGovernmentLead[]> {
  const bounded = Math.min(Math.max(limit, 1), 100);
  return sql.unsafe<PublicGovernmentLead[]>(`${publicLeadSelect}
    WHERE lead.review_status = 'published' AND lead.reviewed_at IS NOT NULL AND lead.published_at IS NOT NULL
    ORDER BY lead.source_published_at DESC NULLS LAST, lead.public_id
    LIMIT $1`, [bounded]);
}

export async function getPublicGovernmentLead(sql: Sql, publicId: string): Promise<PublicGovernmentLead | null> {
  const rows = await sql.unsafe<PublicGovernmentLead[]>(`${publicLeadSelect}
    WHERE lead.public_id = $1 AND lead.review_status = 'published'
      AND lead.reviewed_at IS NOT NULL AND lead.published_at IS NOT NULL
    LIMIT 1`, [publicId]);
  return rows[0] ?? null;
}
