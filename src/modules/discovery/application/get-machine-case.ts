import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface MachineCaseRecord {
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  courtName: string;
  activityState: string;
  proceduralPhase: string;
  dispositionScope: string;
  judgmentState: string;
  appealState: string;
  verification: string;
  statusExplanation: string | null;
  statusRuleVersion: string | null;
  documents: Array<{
    publicId: string;
    title: string;
    filedOn: string | null;
    documentType: string;
  }>;
}

export async function getMachineCase(sql: Sql, publicId: string): Promise<MachineCaseRecord | null> {
  const [record] = await sql<Omit<MachineCaseRecord, "documents">[]>`
    SELECT legal_case.public_id AS "publicId", legal_case.caption,
      legal_case.docket_number AS "docketNumber", legal_case.filed_on::text AS "filedOn",
      court.name AS "courtName", legal_case.activity_state AS "activityState",
      legal_case.procedural_phase AS "proceduralPhase",
      legal_case.disposition_scope AS "dispositionScope",
      legal_case.judgment_state AS "judgmentState", legal_case.appeal_state AS "appealState",
      legal_case.verification::text AS verification,
      legal_case.status_explanation AS "statusExplanation",
      legal_case.status_rule_version AS "statusRuleVersion"
    FROM legal_case JOIN court ON court.id = legal_case.court_id
    WHERE legal_case.public_id = ${publicId} AND legal_case.publication = 'published'
      -- Subscriber-only (search-excluded) records are never in the public, edge-cached machine JSON.
      AND NOT ${sql.unsafe(searchExcludedCaseSql("legal_case"))}
      AND COALESCE((
        SELECT decision.machine_accessible FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    LIMIT 1
  `;
  if (!record) return null;

  const documents = await sql<MachineCaseRecord["documents"]>`
    SELECT document.public_id AS "publicId", document.title,
      document.filed_on::text AS "filedOn", document.document_type AS "documentType"
    FROM document JOIN legal_case ON legal_case.id = document.case_id
    WHERE legal_case.public_id = ${publicId} AND document.publication = 'published'
      AND COALESCE((
        SELECT decision.machine_accessible FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    ORDER BY document.filed_on DESC NULLS LAST, document.public_id
  `;
  return { ...record, documents };
}
