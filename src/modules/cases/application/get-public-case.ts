import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { captionTag, cleanCourtName, courtKindFromJurisdiction, type CourtKind } from "@/modules/cases/domain/record-answers";
import { displayCaption } from "@/modules/cases/domain/case-title";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { readableOpinionExistsSql } from "@/modules/cases/domain/readable-opinion";

type Sql = ReturnType<typeof postgres>;

export interface PublicCase {
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn: string | null;
  terminatedOn?: string | null;
  natureOfSuit?: string | null;
  causeOfAction?: string | null;
  courtKind?: CourtKind;
  /** Provider court code (CourtListener id such as "caed"), used for the Bluebook court abbreviation. */
  courtCode?: string | null;
  /** Highest-confidence (>= 0.8) judge assignment on a displayable case; names are public on judge pages. */
  judgeName?: string | null;
  /** Category from a PACER caption tag such as "(HC)", read before the tag is stripped from the caption. */
  captionCategory?: string | null;
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
  /** True when a published, displayable document on this case has non-empty extracted text (readableOpinionExistsSql). */
  hasReadableOpinion: boolean;
  /**
   * True when the case's current publication decision is a Tier 1 / Tier 2 release
   * (scripts/ops/publish-tiers-1-2.sql, rule publication-tiers-v1) flagged indexable.
   * Only those releases are indexable without opinion text; every other case keeps
   * the hasReadableOpinion rule.
   */
  tierReleaseIndexable?: boolean;
  /** Sealed-related case (search-exclusion rule): displayable, but never indexed or listed in sitemaps. */
  searchExcluded?: boolean;
}

export const TIER_RELEASE_RULE_VERSION = "publication-tiers-v1";
export const INDEXABLE_TIER_RELEASE_REASONS = ["tier1_release", "tier2_release"] as const;

/** Robots decision for a case page: readable opinion text, or an indexable Tier 1/2 release. */
export function casePageIndexable(legalCase: Pick<PublicCase, "hasReadableOpinion" | "tierReleaseIndexable" | "searchExcluded">): boolean {
  if (legalCase.searchExcluded) return false;
  return legalCase.hasReadableOpinion || legalCase.tierReleaseIndexable === true;
}

export async function getPublicCase(sql: Sql, publicId: string): Promise<PublicCase | null> {
  const [row] = await sql<Array<PublicCase & { courtJurisdiction: string | null }>>`
    SELECT
      c.public_id AS "publicId", c.caption, c.docket_number AS "docketNumber",
      c.filed_on::text AS "filedOn", c.decided_on::text AS "decidedOn",
      c.terminated_on::text AS "terminatedOn", c.nature_of_suit_code AS "natureOfSuit",
      c.cause_of_action AS "causeOfAction", court.jurisdiction AS "courtJurisdiction",
      court.provider_court_id AS "courtCode",
      (
        SELECT judge.display_name FROM judge_case_assignment assignment
        JOIN judge ON judge.id = assignment.judge_id
        WHERE assignment.case_id = c.id AND assignment.confidence >= 0.800
        ORDER BY (assignment.assignment_role = 'presiding') DESC, assignment.confidence DESC,
          assignment.started_on DESC NULLS LAST, judge.display_name
        LIMIT 1
      ) AS "judgeName",
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
      enrichment.lower_court_name AS "lowerCourtName", enrichment.lower_court_decided_on::text AS "lowerCourtDecidedOn",
      ${sql.unsafe(readableOpinionExistsSql("c"))} AS "hasReadableOpinion",
      EXISTS (
        SELECT 1 FROM publication_current current_row
        JOIN publication_decision decision ON decision.id = current_row.decision_id
        WHERE current_row.object_type = 'legal_case'
          AND current_row.object_id = c.id
          AND decision.indexable
          AND decision.rule_version = ${TIER_RELEASE_RULE_VERSION}
          AND decision.reason_code = ANY(${[...INDEXABLE_TIER_RELEASE_REASONS]}::text[])
      ) AS "tierReleaseIndexable",
      ${sql.unsafe(searchExcludedCaseSql("c"))} AS "searchExcluded"
    FROM legal_case c
    JOIN court ON court.id = c.court_id
    LEFT JOIN scotus_case_enrichment enrichment ON enrichment.case_id = c.id AND enrichment.verification = 'verified'
    WHERE c.public_id = ${publicId}
      AND c.publication = 'published'
      AND ${sql.unsafe(latestPublicationColumnSql("displayable", "legal_case", "c.id"))}
    LIMIT 1
  `;
  if (!row) return null;
  const { courtJurisdiction, ...record } = row;
  const courtKind = courtKindFromJurisdiction(courtJurisdiction, record.courtName, record.courtCode);
  return {
    ...record,
    captionCategory: captionTag(record.caption),
    caption: displayCaption(record.caption, record.docketNumber, courtKind),
    courtName: cleanCourtName(record.courtName),
    courtKind,
  };
}
