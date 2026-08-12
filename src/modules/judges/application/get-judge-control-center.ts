import type postgres from "postgres";
import { getJudgeAutopilotSnapshot } from "./judge-autopilot";

type Sql = ReturnType<typeof postgres>;

export async function getJudgeControlCenter(sql: Sql) {
  const [snapshot, judges, repairs] = await Promise.all([
    getJudgeAutopilotSnapshot(sql),
    sql<Array<{
      publicId: string; displayName: string; courtName: string | null; active: boolean | null;
      category: "scotus" | "appeals" | "district" | "other" | null;
      status: "active" | "senior" | "former"; appointedYear: number | null;
      president: string | null; presidentParty: string | null;
      serviceTerms: number; assignments: number; observations: number; published: boolean;
      lastUpdated: string;
    }>>`
      SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
        court.name AS "courtName", judge.active,
        primary_term.court_category AS category,
        primary_term.appointing_president AS president,
        primary_term.appointing_president_party AS "presidentParty",
        (SELECT extract(year FROM min(t2.commission_date))::int FROM judge_service_term t2
           WHERE t2.judge_id = judge.id AND t2.commission_date IS NOT NULL) AS "appointedYear",
        CASE
          WHEN EXISTS (SELECT 1 FROM judge_service_term ts WHERE ts.judge_id = judge.id
            AND ts.service_type = 'article_iii_senior' AND ts.ended_on IS NULL) THEN 'senior'
          WHEN judge.active THEN 'active'
          ELSE 'former'
        END AS status,
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
      LEFT JOIN LATERAL (
        SELECT t.court_category, t.appointing_president, t.appointing_president_party
        FROM judge_service_term t
        WHERE t.judge_id = judge.id AND t.source_system = 'fjc'
        ORDER BY (t.ended_on IS NULL) DESC, t.started_on DESC NULLS LAST
        LIMIT 1
      ) primary_term ON true
      WHERE judge.fjc_nid IS NOT NULL
      GROUP BY judge.id, court.name, primary_term.court_category,
        primary_term.appointing_president, primary_term.appointing_president_party
      ORDER BY judge.active DESC NULLS LAST, judge.display_name
      LIMIT 10_000
    `,
    sql<Array<{
      id: string; action: string; reason: string; outcome: string; createdAt: string;
    }>>`
      SELECT id, action, reason, outcome, occurred_at::text AS "createdAt"
      FROM ingestion_repair_action WHERE detector = 'judge-autopilot'
      ORDER BY occurred_at DESC LIMIT 100
    `,
  ]);
  return { generatedAt: new Date().toISOString(), snapshot, judges, repairs };
}
