import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicCase {
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn: string | null;
  supremeCourtTerm: number | null;
  officialCitation: string | null;
  courtName: string;
  activityState: string;
  proceduralPhase: string;
  dispositionScope: string;
  judgmentState: string;
  appealState: string;
  verification: string;
  statusExplanation: string | null;
  statusRuleVersion: string | null;
}

export async function getPublicCase(sql: Sql, publicId: string): Promise<PublicCase | null> {
  const [record] = await sql<PublicCase[]>`
    SELECT
      c.public_id AS "publicId", c.caption, c.docket_number AS "docketNumber",
      c.filed_on::text AS "filedOn", c.decided_on::text AS "decidedOn",
      c.supreme_court_term AS "supremeCourtTerm",
      c.official_citation AS "officialCitation", court.name AS "courtName",
      c.activity_state AS "activityState", c.procedural_phase AS "proceduralPhase",
      c.disposition_scope AS "dispositionScope", c.judgment_state AS "judgmentState",
      c.appeal_state AS "appealState", c.verification::text AS verification,
      c.status_explanation AS "statusExplanation",
      c.status_rule_version AS "statusRuleVersion"
    FROM legal_case c
    JOIN court ON court.id = c.court_id
    WHERE c.public_id = ${publicId}
      AND c.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = c.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    LIMIT 1
  `;
  return record ?? null;
}
