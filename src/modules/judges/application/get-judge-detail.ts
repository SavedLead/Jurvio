import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface JudgeServiceTermDetail {
  courtName: string | null;
  serviceType: string;
  courtCategory: string | null;
  startedOn: string | null;
  endedOn: string | null;
  commissionDate: string | null;
  appointingPresident: string | null;
  appointingPresidentParty: string | null;
  sourceSystem: string;
  sourceUrl: string | null;
}

export interface JudgeDetail {
  publicId: string;
  displayName: string;
  courtName: string | null;
  active: boolean | null;
  judgeType: string | null;
  authority: "article_iii" | "article_i";
  officialProfileUrl: string | null;
  photoUrl: string | null;
  photoSourceUrl: string | null;
  fjcNid: string | null;
  brmagId: string | null;
  verification: string;
  published: boolean;
  assignments: number;
  observations: number;
  updatedAt: string;
  serviceTerms: JudgeServiceTermDetail[];
  nameVariants: Array<{ displayValue: string; variantType: string }>;
  profileFacts: Array<{ factType: string; value: unknown }>;
}

export async function getJudgeDetail(sql: Sql, publicId: string): Promise<JudgeDetail | null> {
  const [judge] = await sql<Array<{
    id: string; publicId: string; displayName: string; courtName: string | null; active: boolean | null;
    judgeType: string | null; officialProfileUrl: string | null; photoUrl: string | null;
    photoSourceUrl: string | null; fjcNid: string | null; brmagId: string | null; verification: string;
    published: boolean; assignments: number; observations: number; updatedAt: string;
  }>>`
    SELECT judge.id, judge.public_id AS "publicId", judge.display_name AS "displayName",
      court.name AS "courtName", judge.active, judge.judge_type AS "judgeType",
      judge.official_profile_url AS "officialProfileUrl", judge.photo_url AS "photoUrl",
      judge.photo_source_url AS "photoSourceUrl", judge.fjc_nid AS "fjcNid", judge.brmag_id AS "brmagId",
      judge.verification::text AS verification,
      EXISTS (SELECT 1 FROM publication_decision pd
        WHERE pd.object_type = 'judge' AND pd.object_id = judge.id AND pd.displayable = true) AS published,
      (SELECT count(*)::int FROM judge_case_assignment a WHERE a.judge_id = judge.id) AS assignments,
      (SELECT count(*)::int FROM judge_case_observation o WHERE o.judge_id = judge.id) AS observations,
      judge.updated_at::text AS "updatedAt"
    FROM judge
    LEFT JOIN court ON court.id = judge.court_id
    WHERE judge.public_id = ${publicId}
    LIMIT 1
  `;
  if (!judge) return null;

  const [serviceTerms, nameVariants, profileFacts] = await Promise.all([
    sql<Array<JudgeServiceTermDetail>>`
      SELECT court.name AS "courtName", term.service_type AS "serviceType",
        term.court_category AS "courtCategory", term.started_on::text AS "startedOn",
        term.ended_on::text AS "endedOn", term.commission_date::text AS "commissionDate",
        term.appointing_president AS "appointingPresident",
        term.appointing_president_party AS "appointingPresidentParty",
        term.source_system AS "sourceSystem", term.source_url AS "sourceUrl"
      FROM judge_service_term term
      LEFT JOIN court ON court.id = term.court_id
      WHERE term.judge_id = ${judge.id}
      ORDER BY term.started_on DESC NULLS LAST, term.commission_date DESC NULLS LAST
    `,
    sql<Array<{ displayValue: string; variantType: string }>>`
      SELECT display_value AS "displayValue", variant_type AS "variantType"
      FROM judge_name_variant WHERE judge_id = ${judge.id}
      ORDER BY variant_type, display_value
    `,
    sql<Array<{ factType: string; value: unknown }>>`
      SELECT fact_type AS "factType", value_json AS value
      FROM judge_profile_fact WHERE judge_id = ${judge.id}
      ORDER BY fact_type
    `,
  ]);

  const authority: "article_iii" | "article_i" =
    serviceTerms.some((t) => t.courtCategory === "bankruptcy" || t.courtCategory === "magistrate")
      ? "article_i" : "article_iii";

  return {
    publicId: judge.publicId, displayName: judge.displayName, courtName: judge.courtName,
    active: judge.active, judgeType: judge.judgeType, authority,
    officialProfileUrl: judge.officialProfileUrl, photoUrl: judge.photoUrl,
    photoSourceUrl: judge.photoSourceUrl, fjcNid: judge.fjcNid, brmagId: judge.brmagId,
    verification: judge.verification, published: judge.published, assignments: judge.assignments,
    observations: judge.observations, updatedAt: judge.updatedAt,
    serviceTerms, nameVariants, profileFacts,
  };
}
