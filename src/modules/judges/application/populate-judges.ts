import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { cleanJudgeDisplayName, normalizeJudgeName } from "../domain/normalize-judge-name";

type Sql = ReturnType<typeof postgres>;
type Candidate = { authorName: string; caseId: string; courtId: string; sourceArtifactId: string };

export async function populateJudgesFromOpinions(
  sql: Sql,
  options: { limit?: number } = {},
): Promise<{ scanned: number; judgesCreated: number; assignmentsCreated: number; skipped: number }> {
  const limit = Math.min(Math.max(options.limit ?? 5_000, 1), 50_000);
  const candidates = await sql<Candidate[]>`
    SELECT DISTINCT judicial_opinion.author_name AS "authorName",
      document.case_id AS "caseId", legal_case.court_id AS "courtId",
      judicial_opinion.source_artifact_id AS "sourceArtifactId"
    FROM judicial_opinion
    JOIN document ON document.id = judicial_opinion.document_id
    JOIN legal_case ON legal_case.id = document.case_id
    WHERE judicial_opinion.author_name IS NOT NULL
      AND btrim(judicial_opinion.author_name) <> ''
      AND judicial_opinion.per_curiam = false
      AND judicial_opinion.source_artifact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM judge_case_assignment existing_assignment
        WHERE existing_assignment.case_id = document.case_id
          AND existing_assignment.assignment_role = 'opinion_author'
          AND existing_assignment.source_artifact_id = judicial_opinion.source_artifact_id
      )
    ORDER BY document.case_id
    LIMIT ${limit}
  `;
  let judgesCreated = 0, assignmentsCreated = 0, skipped = 0;
  for (const candidate of candidates) {
    const displayName = cleanJudgeDisplayName(candidate.authorName);
    const normalizedName = normalizeJudgeName(candidate.authorName);
    if (!displayName || !normalizedName) { skipped += 1; continue; }
    await sql.begin(async (tx) => {
      let [judge] = await tx<{ id: string }[]>`
        SELECT id FROM judge
        WHERE normalized_name = ${normalizedName} AND court_id = ${candidate.courtId}
        LIMIT 1 FOR UPDATE
      `;
      if (!judge) {
        [judge] = await tx<{ id: string }[]>`
          INSERT INTO judge (public_id, display_name, normalized_name, court_id, verification, source_artifact_id)
          VALUES (${createPublicId("judge")}, ${displayName}, ${normalizedName}, ${candidate.courtId}, 'verified', ${candidate.sourceArtifactId})
          ON CONFLICT (court_id, normalized_name) DO UPDATE SET
            source_artifact_id = COALESCE(judge.source_artifact_id, EXCLUDED.source_artifact_id), updated_at = now()
          RETURNING id
        `;
        if (!judge) throw new Error("Judge identity was not persisted");
        judgesCreated += 1;
      }
      const assignments = await tx<{ id: string }[]>`
        INSERT INTO judge_case_assignment (
          judge_id, case_id, assignment_role, source_artifact_id, extraction_method, extractor_version, confidence
        ) VALUES (
          ${judge.id}, ${candidate.caseId}, 'opinion_author', ${candidate.sourceArtifactId},
          'source_field', 'courtlistener-opinion-author-v1', 1.000
        ) ON CONFLICT (judge_id, case_id, assignment_role, started_on) DO NOTHING RETURNING id
      `;
      assignmentsCreated += assignments.length;
      await tx`
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        )
        SELECT 'judge', ${judge.id}, true, true, true, false, false,
          'verified_source_identity', 'judge-publication-v1'
        WHERE NOT EXISTS (
          SELECT 1 FROM publication_decision WHERE object_type = 'judge' AND object_id = ${judge.id}
        )
      `;
    });
  }
  return { scanned: candidates.length, judgesCreated, assignmentsCreated, skipped };
}
