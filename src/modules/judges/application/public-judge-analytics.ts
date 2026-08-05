import type postgres from "postgres";

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

export async function listPublicJudges(sql: Sql, limit = 100): Promise<JudgeDirectorySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return sql<JudgeDirectorySummary[]>`
    SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
      court.name AS "courtName", count(DISTINCT legal_case.id)::int AS "caseCount",
      count(DISTINCT observation.id)::int AS "outcomeSample"
    FROM judge
    LEFT JOIN court ON court.id = judge.court_id
    JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
    JOIN legal_case ON legal_case.id = assignment.case_id
    LEFT JOIN judge_case_observation observation
      ON observation.judge_id = judge.id AND observation.case_id = legal_case.id
      AND observation.observation_type = 'case_outcome' AND observation.confidence >= 0.800
    WHERE ${sql.unsafe(displayableJudge)} AND ${sql.unsafe(displayableCase)}
    GROUP BY judge.id, court.name
    ORDER BY count(DISTINCT legal_case.id) DESC, judge.display_name
    LIMIT ${safeLimit}
  `;
}

export async function getPublicJudge(sql: Sql, publicId: string): Promise<JudgeAnalyticsProfile | null> {
  const [summary] = await sql<Array<Omit<JudgeAnalyticsProfile, "natureOfSuit" | "recentCases">>>`
    SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
      court.name AS "courtName", judge.verification::text AS verification,
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
    JOIN judge_case_assignment assignment ON assignment.judge_id = judge.id
    JOIN legal_case ON legal_case.id = assignment.case_id
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
      AND ${sql.unsafe(displayableJudge)} AND ${sql.unsafe(displayableCase)}
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
