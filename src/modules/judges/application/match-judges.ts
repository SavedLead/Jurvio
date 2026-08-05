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
          AND match.matcher_version = 'fjc-time-aware-v1'
      )
    ORDER BY opinion_cluster.date_filed DESC NULLS LAST, judicial_opinion.id
    LIMIT ${limit}
  `;
  let accepted = 0, needsReview = 0, unmatched = 0;
  for (const observation of observations) {
    const normalized = normalizeJudgeName(observation.authorName);
    if (!normalized) { unmatched += 1; continue; }
    const candidates = await sql<{ judgeId: string }[]>`
      SELECT DISTINCT variant.judge_id AS "judgeId"
      FROM judge_name_variant variant
      JOIN judge_service_term term ON term.judge_id = variant.judge_id
      WHERE variant.normalized_value = ${normalized}
        AND term.court_id = ${observation.courtId}
        AND (${observation.relevantOn}::date IS NULL OR term.started_on IS NULL OR term.started_on <= ${observation.relevantOn}::date)
        AND (${observation.relevantOn}::date IS NULL OR term.ended_on IS NULL OR term.ended_on >= ${observation.relevantOn}::date)
    `;
    const status = candidates.length === 1 ? 'accepted' : candidates.length > 1 ? 'needs_review' : 'unmatched';
    const score = candidates.length === 1 ? 1 : candidates.length > 1 ? 0.6 : 0;
    if (status === 'accepted') accepted += 1;
    else if (status === 'needs_review') needsReview += 1;
    else unmatched += 1;
    const rows = candidates.length ? candidates : [{ judgeId: null }];
    for (const candidate of rows) {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO judge_match_candidate (case_id, judge_id, source_artifact_id, observed_name,
            observed_normalized_name, relevant_on, court_id, score, signals, status, matcher_version, decided_at)
          VALUES (${observation.caseId}, ${candidate.judgeId}, ${observation.sourceArtifactId},
            ${observation.authorName}, ${normalized}, ${observation.relevantOn}, ${observation.courtId}, ${score},
            ${tx.json({ exactName: true, courtAndDateEligible: candidates.length > 0, candidateCount: candidates.length })},
            ${status}, 'fjc-time-aware-v1', ${status === 'accepted' ? new Date() : null})
          ON CONFLICT DO NOTHING
        `;
        if (status === 'accepted' && candidate.judgeId) {
          await tx`
            INSERT INTO judge_case_assignment (judge_id, case_id, assignment_role, source_artifact_id,
              extraction_method, extractor_version, confidence)
            VALUES (${candidate.judgeId}, ${observation.caseId}, 'opinion_author', ${observation.sourceArtifactId},
              'deterministic_rule', 'fjc-time-aware-v1', 1.000)
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
