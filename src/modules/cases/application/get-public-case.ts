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
  backgroundSummary: string | null;
  backgroundSourceUrl: string | null;
  significanceSummary: string | null;
  significanceSourceUrl: string | null;
  questionPresented: string | null;
  questionSourceUrl: string | null;
  exactHolding: string | null;
  holdingSourceUrl: string | null;
  exactDisposition: string | null;
  dispositionSourceUrl: string | null;
  decisionLineup: {
    perCuriam?: boolean;
    author?: string | null;
    joins?: string[];
    separateOpinions?: Array<{ author: string; type: string; joins?: string[] }>;
    recusals?: string[];
    justiceVotes?: Array<{ justice: string; position: string }>;
    voteBreakdown?: {
      forJudgment: number;
      courtOpinion: number;
      concurring: number;
      dissenting: number;
      mixed: number;
      notParticipating: number;
      label: string | null;
    };
  } | null;
  officialDocketUrl: string | null;
  lowerCourtName: string | null;
  lowerCourtDecidedOn: string | null;
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
      c.status_rule_version AS "statusRuleVersion",
      enrichment.background_summary AS "backgroundSummary", enrichment.background_source_url AS "backgroundSourceUrl",
      enrichment.significance_summary AS "significanceSummary", enrichment.significance_source_url AS "significanceSourceUrl",
      enrichment.question_presented AS "questionPresented", enrichment.question_source_url AS "questionSourceUrl",
      enrichment.exact_holding AS "exactHolding", enrichment.holding_source_url AS "holdingSourceUrl",
      enrichment.exact_disposition AS "exactDisposition", enrichment.disposition_source_url AS "dispositionSourceUrl",
      enrichment.decision_lineup AS "decisionLineup", enrichment.official_docket_url AS "officialDocketUrl",
      enrichment.lower_court_name AS "lowerCourtName", enrichment.lower_court_decided_on::text AS "lowerCourtDecidedOn"
    FROM legal_case c
    JOIN court ON court.id = c.court_id
    LEFT JOIN scotus_case_enrichment enrichment ON enrichment.case_id = c.id AND enrichment.verification = 'verified'
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
