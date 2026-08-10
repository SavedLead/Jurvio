import type postgres from "postgres";
import { getJudgeAutopilotSnapshot } from "./judge-autopilot";

type Sql = ReturnType<typeof postgres>;

export async function getJudgeControlCenter(sql: Sql) {
  const [snapshot, judges, repairs] = await Promise.all([
    getJudgeAutopilotSnapshot(sql),
    sql<Array<{
      publicId: string; displayName: string; courtName: string | null; active: boolean | null;
      serviceTerms: number; assignments: number; observations: number; published: boolean;
      lastUpdated: string;
    }>>`
      SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
        court.name AS "courtName", judge.active,
        count(DISTINCT term.id)::int AS "serviceTerms",
        count(DISTINCT assignment.id)::int AS assignments,
        count(DISTINCT observation.id)::int AS observations,
        EXISTS (SELECT 1 FROM publication_decision pd
          WHERE pd.object_type = 'judge' AND pd.object_id = judge.id AND pd.displayable = true) AS published,
        judge.updated_at::text AS "lastUpdated"
      FROM judge
      LEFT JOIN court ON court.id = judge.court_id
      LEFT JOIN judge_service_term term ON term.judge_id = judge.id
      LEFT JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
      LEFT JOIN judge_case_observation observation ON observation.judge_id = judge.id
      WHERE judge.fjc_nid IS NOT NULL
      GROUP BY judge.id, court.name
      ORDER BY judge.active DESC NULLS LAST, judge.display_name
      LIMIT 10_000
    `,
    sql<Array<{
      id: string; action: string; reason: string; outcome: string; createdAt: string;
    }>>`
      SELECT id, action, reason, outcome, created_at::text AS "createdAt"
      FROM ingestion_repair_action WHERE detector = 'judge-autopilot'
      ORDER BY created_at DESC LIMIT 100
    `,
  ]);
  return { generatedAt: new Date().toISOString(), snapshot, judges, repairs };
}
