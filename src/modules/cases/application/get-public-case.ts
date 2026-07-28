import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicCase {
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
  statusFact: string | null;
  statusProceduralPossibilities: string[];
  statusSourceUri: string | null;
  statusSourceLabel: string | null;
  statusVerifiedAt: string | null;
  statusRuleVersion: string | null;
}

export async function getPublicCase(sql: Sql, publicId: string): Promise<PublicCase | null> {
  const [record] = await sql<PublicCase[]>`
    SELECT
      c.public_id AS "publicId", c.caption, c.docket_number AS "docketNumber",
      c.filed_on::text AS "filedOn", court.name AS "courtName",
      c.activity_state AS "activityState", c.procedural_phase AS "proceduralPhase",
      c.disposition_scope AS "dispositionScope", c.judgment_state AS "judgmentState",
      c.appeal_state AS "appealState", c.verification::text AS verification,
      c.status_explanation AS "statusExplanation",
      c.status_fact AS "statusFact",
      c.status_procedural_possibilities AS "statusProceduralPossibilities",
      artifact.source_uri AS "statusSourceUri",
      event.source_label AS "statusSourceLabel",
      COALESCE(c.status_verified_at, event.verified_at)::text AS "statusVerifiedAt",
      c.status_rule_version AS "statusRuleVersion"
    FROM legal_case c
    JOIN court ON court.id = c.court_id
    LEFT JOIN case_status_event event ON event.id = c.status_event_id
    LEFT JOIN raw_artifact artifact ON artifact.id = event.source_artifact_id
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
