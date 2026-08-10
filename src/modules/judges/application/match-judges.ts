import type postgres from "postgres";
import { normalizeJudgeName } from "../domain/normalize-judge-name";

type Sql = ReturnType<typeof postgres>;
type Observation = {
  authorName: string;
  caseId: string;
  courtId: string;
  relevantOn: string | null;
  sourceArtifactId: string;
};
type EligibleVariant = { judgeId: string; normalizedValue: string };
export type RankedJudgeCandidate = {
  judgeId: string;
  score: number;
  exactName: boolean;
  surnameMatch: boolean;
  initialsCompatible: boolean;
};

function tokens(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

/** Rank only judges who were eligible in the case court on the relevant date. */
export function rankEligibleJudges(
  observedNormalized: string,
  variants: EligibleVariant[],
): RankedJudgeCandidate[] {
  const observed = tokens(observedNormalized);
  const observedSurname = observed.at(-1);
  if (!observedSurname) return [];
  const byJudge = new Map<string, RankedJudgeCandidate>();
  for (const variant of variants) {
    const candidate = tokens(variant.normalizedValue);
    const candidateSurname = candidate.at(-1);
    const exactName = variant.normalizedValue === observedNormalized;
    const surnameMatch = candidateSurname === observedSurname;
    const observedGiven = observed.slice(0, -1);
    const candidateGiven = candidate.slice(0, -1);
    const initialsCompatible = surnameMatch && observedGiven.length > 0
      && observedGiven.every((part, index) => {
        const other = candidateGiven[index];
        return Boolean(other && (part === other || part[0] === other[0]));
      });
    const score = exactName ? 1 : initialsCompatible ? 0.95 : surnameMatch ? 0.7 : 0;
    if (!score) continue;
    const previous = byJudge.get(variant.judgeId);
    if (!previous || score > previous.score) {
      byJudge.set(variant.judgeId, {
        judgeId: variant.judgeId, score, exactName, surnameMatch, initialsCompatible,
      });
    }
  }
  return [...byJudge.values()].sort((left, right) => right.score - left.score);
}

export function decideJudgeMatch(candidates: RankedJudgeCandidate[]): {
  status: "accepted" | "needs_review" | "unmatched";
  acceptedJudgeId: string | null;
} {
  const [first, second] = candidates;
  if (!first) return { status: "unmatched", acceptedJudgeId: null };
  if (first.score >= 0.9 && (!second || first.score - second.score >= 0.1)) {
    return { status: "accepted", acceptedJudgeId: first.judgeId };
  }
  return { status: "needs_review", acceptedJudgeId: null };
}

export async function matchJudgesToCases(
  sql: Sql,
  options: { limit?: number } = {},
): Promise<{ scanned: number; accepted: number; needsReview: number; unmatched: number }> {
  const limit = Math.min(Math.max(options.limit ?? 5_000, 1), 50_000);
  const observations = await sql<Observation[]>`
    SELECT judicial_opinion.author_name AS "authorName", document.case_id AS "caseId",
      legal_case.court_id AS "courtId", opinion_cluster.date_filed AS "relevantOn",
      judicial_opinion.source_artifact_id AS "sourceArtifactId"
    FROM judicial_opinion
    JOIN opinion_cluster ON opinion_cluster.id = judicial_opinion.cluster_id
    JOIN document ON document.id = judicial_opinion.document_id
    JOIN legal_case ON legal_case.id = document.case_id
    WHERE judicial_opinion.author_name IS NOT NULL
      AND btrim(judicial_opinion.author_name) <> ''
      AND judicial_opinion.per_curiam = false
      AND NOT EXISTS (
        SELECT 1 FROM judge_match_candidate match
        WHERE match.case_id = document.case_id
          AND match.source_artifact_id = judicial_opinion.source_artifact_id
          AND match.matcher_version = 'jurisdiction-timeframe-v2'
      )
    ORDER BY opinion_cluster.date_filed DESC NULLS LAST, judicial_opinion.id
    LIMIT ${limit}
  `;
  let accepted = 0, needsReview = 0, unmatched = 0;
  for (const observation of observations) {
    const normalized = normalizeJudgeName(observation.authorName);
    if (!normalized) { unmatched += 1; continue; }
    const eligible = await sql<EligibleVariant[]>`
      SELECT DISTINCT variant.judge_id AS "judgeId", variant.normalized_value AS "normalizedValue"
      FROM judge_service_term term
      JOIN judge_name_variant variant ON variant.judge_id = term.judge_id
      WHERE term.court_id = ${observation.courtId}
        AND (${observation.relevantOn}::date IS NULL OR term.started_on IS NULL OR term.started_on <= ${observation.relevantOn}::date)
        AND (${observation.relevantOn}::date IS NULL OR term.ended_on IS NULL OR term.ended_on >= ${observation.relevantOn}::date)
    `;
    const candidates = rankEligibleJudges(normalized, eligible);
    const decision = decideJudgeMatch(candidates);
    if (decision.status === "accepted") accepted += 1;
    else if (decision.status === "needs_review") needsReview += 1;
    else unmatched += 1;
    const rows: Array<RankedJudgeCandidate | null> = candidates.slice(0, 10).length
      ? candidates.slice(0, 10) : [null];
    for (const candidate of rows) {
      const candidateStatus = decision.acceptedJudgeId === candidate?.judgeId
        ? "accepted"
        : decision.status === "unmatched" ? "unmatched" : "needs_review";
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO judge_match_candidate (case_id, judge_id, source_artifact_id, observed_name,
            observed_normalized_name, relevant_on, court_id, score, signals, status, matcher_version, decided_at)
          VALUES (${observation.caseId}, ${candidate?.judgeId ?? null}, ${observation.sourceArtifactId},
            ${observation.authorName}, ${normalized}, ${observation.relevantOn}, ${observation.courtId}, ${candidate?.score ?? 0},
            ${tx.json({ jurisdictionAndTimeEligible: Boolean(candidate), eligibleCount: eligible.length,
              rankedCount: candidates.length, exactName: candidate?.exactName ?? false,
              surnameMatch: candidate?.surnameMatch ?? false, initialsCompatible: candidate?.initialsCompatible ?? false })},
            ${candidateStatus}, 'jurisdiction-timeframe-v2', ${candidateStatus === 'accepted' ? new Date() : null})
          ON CONFLICT DO NOTHING
        `;
        if (candidateStatus === "accepted" && candidate) {
          await tx`
            INSERT INTO judge_case_assignment (judge_id, case_id, assignment_role, source_artifact_id,
              extraction_method, extractor_version, confidence)
            VALUES (${candidate.judgeId}, ${observation.caseId}, 'opinion_author', ${observation.sourceArtifactId},
              'deterministic_rule', 'jurisdiction-timeframe-v2', ${candidate.score})
            ON CONFLICT (judge_id, case_id, assignment_role, started_on) DO NOTHING
          `;
          await tx`
            INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version)
            SELECT 'judge', ${candidate.judgeId}, true, true, true, false, false,
              'verified_fjc_identity', 'judge-publication-v2'
            WHERE NOT EXISTS (
              SELECT 1 FROM publication_decision WHERE object_type = 'judge' AND object_id = ${candidate.judgeId}
            )
          `;
        }
      });
    }
  }
  return { scanned: observations.length, accepted, needsReview, unmatched };
}
