import type postgres from "postgres";
import { isMissingTable } from "@/modules/directory/application/public-directory-stats";

type Sql = ReturnType<typeof postgres>;

export interface JudgeDirectorySummary {
  publicId: string;
  displayName: string;
  courtName: string | null;
  caseCount: number;
  outcomeSample: number;
}

export interface JudgeAnalyticsProfile extends JudgeDirectorySummary {
  verification: string;
  indexable: boolean;
  photoUrl: string | null;
  photoSourceUrl: string | null;
  plaintiffWins: number;
  defendantWins: number;
  mixedOutcomes: number;
  averageAward: number | null;
  medianAward: number | null;
  awardSample: number;
  averageDaysToMajorRuling: number | null;
  rulingTimeSample: number;
  natureOfSuit: Array<{ code: string; caseCount: number; outcomeSample: number }>;
  recentCases: Array<{
    publicId: string;
    caption: string;
    docketNumber: string;
    courtName: string;
    filedOn: string | null;
  }>;
}

const displayableCase = `
  legal_case.publication = 'published'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)
`;

const displayableJudge = `
  judge.verification = 'verified'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)
`;

export function calculateOutcomeRates(input: {
  plaintiffWins: number;
  defendantWins: number;
  mixedOutcomes: number;
}) {
  const sample = input.plaintiffWins + input.defendantWins + input.mixedOutcomes;
  const percent = (count: number) => sample ? Math.round((count / sample) * 1000) / 10 : null;
  return {
    sample,
    plaintiffPercent: percent(input.plaintiffWins),
    defendantPercent: percent(input.defendantWins),
    mixedPercent: percent(input.mixedOutcomes),
  };
}

export async function listPublicJudges(sql: Sql, limit = 5_000): Promise<JudgeDirectorySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10_000);
  return sql<JudgeDirectorySummary[]>`
    SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
      court.name AS "courtName", count(DISTINCT legal_case.id)::int AS "caseCount",
      count(DISTINCT observation.id)::int AS "outcomeSample"
    FROM judge
    LEFT JOIN court ON court.id = judge.court_id
    LEFT JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
    LEFT JOIN legal_case ON legal_case.id = assignment.case_id
      AND ${sql.unsafe(displayableCase)}
    LEFT JOIN judge_case_observation observation
      ON observation.judge_id = judge.id AND observation.case_id = legal_case.id
      AND observation.observation_type = 'case_outcome' AND observation.confidence >= 0.800
    WHERE ${sql.unsafe(displayableJudge)}
    GROUP BY judge.id, court.name
    ORDER BY count(DISTINCT legal_case.id) DESC, judge.display_name
    LIMIT ${safeLimit}
  `;
}

export const JUDGE_DIRECTORY_PAGE_SIZE = 200;

export interface JudgeDirectoryPage {
  judges: JudgeDirectorySummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One page of the judge directory from judge_public_stats (refreshed by the
 * citations-lane `public-directory-stats` job), most public cases first. The
 * judge's verification and publication decision are still checked live. Falls
 * back to the live aggregate when the table is missing or not refreshed yet.
 */
export async function listPublicJudgePage(
  sql: Sql,
  options: { page?: number; pageSize?: number } = {},
): Promise<JudgeDirectoryPage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? JUDGE_DIRECTORY_PAGE_SIZE, 1), 500);
  const page = Math.min(Math.max(Math.trunc(options.page ?? 1) || 1, 1), 1000);
  try {
    const rows = await sql<Array<JudgeDirectorySummary & { total: number }>>`
      SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
        court.name AS "courtName", stats.case_count AS "caseCount",
        stats.outcome_sample AS "outcomeSample",
        count(*) OVER ()::int AS total
      FROM judge_public_stats stats
      JOIN judge ON judge.id = stats.judge_id
      LEFT JOIN court ON court.id = judge.court_id
      WHERE ${sql.unsafe(displayableJudge)}
      ORDER BY stats.case_count DESC, judge.display_name, judge.public_id
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    if (rows.length || page > 1) {
      const total = rows[0]?.total ?? 0;
      const judges = rows.map((row) => ({
        publicId: row.publicId, displayName: row.displayName, courtName: row.courtName,
        caseCount: row.caseCount, outcomeSample: row.outcomeSample,
      }));
      return { judges, total, page, pageSize };
    }
    const [refreshed] = await sql<{ any: boolean }[]>`SELECT EXISTS (SELECT 1 FROM judge_public_stats) AS any`;
    if (refreshed?.any) return { judges: [], total: 0, page, pageSize };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  const all = await listPublicJudges(sql, 10_000);
  return { judges: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

export async function getPublicJudge(sql: Sql, publicId: string): Promise<JudgeAnalyticsProfile | null> {
  const [summary] = await sql<Array<Omit<JudgeAnalyticsProfile, "natureOfSuit" | "recentCases">>>`
    SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
      court.name AS "courtName", judge.verification::text AS verification,
      judge.photo_url AS "photoUrl", judge.photo_source_url AS "photoSourceUrl",
      COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false) AS indexable,
      count(DISTINCT legal_case.id)::int AS "caseCount",
      count(DISTINCT outcome.id)::int AS "outcomeSample",
      count(DISTINCT outcome.id) FILTER (WHERE outcome.favored_side = 'plaintiff')::int AS "plaintiffWins",
      count(DISTINCT outcome.id) FILTER (WHERE outcome.favored_side = 'defendant')::int AS "defendantWins",
      count(DISTINCT outcome.id) FILTER (WHERE outcome.favored_side = 'mixed')::int AS "mixedOutcomes",
      avg(award.amount_usd)::float8 AS "averageAward",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY award.amount_usd)::float8 AS "medianAward",
      count(DISTINCT award.id)::int AS "awardSample",
      avg((ruling.occurred_on - legal_case.filed_on))::float8 AS "averageDaysToMajorRuling",
      count(DISTINCT ruling.id) FILTER (
        WHERE ruling.occurred_on IS NOT NULL AND legal_case.filed_on IS NOT NULL
      )::int AS "rulingTimeSample"
    FROM judge
    LEFT JOIN court ON court.id = judge.court_id
    LEFT JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
    LEFT JOIN legal_case ON legal_case.id = assignment.case_id
      AND ${sql.unsafe(displayableCase)}
    LEFT JOIN judge_case_observation outcome
      ON outcome.judge_id = judge.id AND outcome.case_id = legal_case.id
      AND outcome.observation_type = 'case_outcome' AND outcome.confidence >= 0.800
    LEFT JOIN judge_case_observation award
      ON award.judge_id = judge.id AND award.case_id = legal_case.id
      AND award.observation_type = 'monetary_award' AND award.confidence >= 0.900
    LEFT JOIN judge_case_observation ruling
      ON ruling.judge_id = judge.id AND ruling.case_id = legal_case.id
      AND ruling.observation_type = 'major_ruling' AND ruling.confidence >= 0.800
    WHERE judge.public_id = ${publicId}
      AND ${sql.unsafe(displayableJudge)}
    GROUP BY judge.id, court.name
    LIMIT 1
  `;
  if (!summary) return null;

  const natureOfSuit = await sql<JudgeAnalyticsProfile["natureOfSuit"]>`
    SELECT COALESCE(legal_case.nature_of_suit_code, 'Unspecified') AS code,
      count(DISTINCT legal_case.id)::int AS "caseCount",
      count(DISTINCT observation.id)::int AS "outcomeSample"
    FROM judge
    JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
    JOIN legal_case ON legal_case.id = assignment.case_id
    LEFT JOIN judge_case_observation observation
      ON observation.judge_id = judge.id AND observation.case_id = legal_case.id
      AND observation.observation_type = 'case_outcome' AND observation.confidence >= 0.800
    WHERE judge.public_id = ${publicId} AND ${sql.unsafe(displayableCase)}
    GROUP BY COALESCE(legal_case.nature_of_suit_code, 'Unspecified')
    ORDER BY count(DISTINCT legal_case.id) DESC, code
    LIMIT 25
  `;

  const recentCases = await sql<JudgeAnalyticsProfile["recentCases"]>`
    SELECT legal_case.public_id AS "publicId", legal_case.caption,
      legal_case.docket_number AS "docketNumber", court.name AS "courtName",
      legal_case.filed_on::text AS "filedOn"
    FROM judge
    JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
    JOIN legal_case ON legal_case.id = assignment.case_id
    JOIN court ON court.id = legal_case.court_id
    WHERE judge.public_id = ${publicId} AND ${sql.unsafe(displayableCase)}
    ORDER BY legal_case.filed_on DESC NULLS LAST, legal_case.caption
    LIMIT 50
  `;

  return { ...summary, natureOfSuit, recentCases };
}
