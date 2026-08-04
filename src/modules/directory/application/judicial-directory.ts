import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface JudgeSummary { publicId: string; displayName: string; courtName: string; caseCount: number; latestCaseDate: string | null }
export interface JudgeProfile extends JudgeSummary {
  verification: string; authoritativeSourceUrl: string; indexable: boolean;
  appointments: Array<{ courtPublicId: string; courtName: string; positionTitle: string; appointmentType: string; appointedByName: string | null; appointedByOffice: string | null; serviceStartedOn: string | null; serviceEndedOn: string | null; sourceUrl: string; verifiedOn: string }>;
  cases: Array<{ publicId: string; caption: string; docketNumber: string; courtName: string; filedOn: string | null; relationshipType: string; sourceUrl: string | null }>;
}
export interface QualifiedCourtProfile {
  publicId: string; name: string; shortName: string | null; jurisdiction: string | null; sourceUrl: string;
  verification: string; indexable: boolean; caseCount: number; latestCaseDate: string | null;
  courtLevel: string | null; roleSummary: string | null; jurisdictionSummary: string | null; geographicScope: string | null;
  detailSourceUrl: string | null; detailVerifiedOn: string | null;
  judges: Array<{ publicId: string; displayName: string; positionTitle: string; serviceStartedOn: string | null; serviceEndedOn: string | null }>;
  cases: Array<{ publicId: string; caption: string; docketNumber: string; filedOn: string | null }>;
}

const displayableCase = `legal_case.publication = 'published' AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)`;

export function canPublishJudge(input: { verification: string; authoritativeSourceUrl?: string | null; appointmentCount: number; caseCount: number }) {
  return input.verification === "verified" && Boolean(input.authoritativeSourceUrl?.trim()) && input.appointmentCount > 0 && input.caseCount > 0;
}
export function mayInferPoliticalParty() { return false; }

export async function listPublicJudges(sql: Sql, limit = 50): Promise<JudgeSummary[]> {
  return sql<JudgeSummary[]>`
    SELECT judge.public_id AS "publicId", judge.display_name AS "displayName",
      min(court.name) AS "courtName", count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate"
    FROM judge JOIN judicial_appointment appointment ON appointment.judge_id = judge.id
    JOIN court ON court.id = appointment.court_id JOIN judge_case_relationship relationship ON relationship.judge_id = judge.id
    JOIN legal_case ON legal_case.id = relationship.case_id
    WHERE judge.verification = 'verified' AND judge.authoritative_source_url IS NOT NULL AND court.verification = 'verified'
      AND ${sql.unsafe(displayableCase)} AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'judge' AND decision.object_id = judge.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY judge.id ORDER BY count(DISTINCT legal_case.id) DESC, judge.display_name LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `;
}

export async function getPublicJudge(sql: Sql, publicId: string): Promise<JudgeProfile | null> {
  const [judge] = await sql<Array<Omit<JudgeProfile, "appointments" | "cases">>>`
    SELECT judge.public_id AS "publicId", judge.display_name AS "displayName", judge.verification::text AS verification,
      judge.authoritative_source_url AS "authoritativeSourceUrl", min(court.name) AS "courtName",
      count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate",
      COALESCE((SELECT decision.indexable FROM publication_decision decision WHERE decision.object_type = 'judge' AND decision.object_id = judge.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false) AS indexable
    FROM judge JOIN judicial_appointment appointment ON appointment.judge_id = judge.id JOIN court ON court.id = appointment.court_id
    JOIN judge_case_relationship relationship ON relationship.judge_id = judge.id JOIN legal_case ON legal_case.id = relationship.case_id
    WHERE judge.public_id = ${publicId} AND judge.verification = 'verified' AND judge.authoritative_source_url IS NOT NULL
      AND court.verification = 'verified' AND ${sql.unsafe(displayableCase)}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'judge' AND decision.object_id = judge.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY judge.id LIMIT 1
  `;
  if (!judge) return null;
  const appointments = await sql<JudgeProfile["appointments"]>`
    SELECT court.public_id AS "courtPublicId", court.name AS "courtName", appointment.position_title AS "positionTitle",
      appointment.appointment_type AS "appointmentType", appointment.appointed_by_name AS "appointedByName", appointment.appointed_by_office AS "appointedByOffice",
      appointment.service_started_on::text AS "serviceStartedOn", appointment.service_ended_on::text AS "serviceEndedOn",
      appointment.source_url AS "sourceUrl", appointment.verified_on::text AS "verifiedOn"
    FROM judicial_appointment appointment JOIN judge ON judge.id = appointment.judge_id JOIN court ON court.id = appointment.court_id
    WHERE judge.public_id = ${publicId} AND court.verification = 'verified' ORDER BY appointment.service_ended_on DESC NULLS FIRST, appointment.service_started_on DESC NULLS LAST
  `;
  const cases = await sql<JudgeProfile["cases"]>`
    SELECT legal_case.public_id, legal_case.caption, legal_case.docket_number AS "docketNumber", court.name AS "courtName",
      legal_case.filed_on::text AS "filedOn", relationship.relationship_type AS "relationshipType", relationship.source_url AS "sourceUrl"
    FROM judge_case_relationship relationship JOIN judge ON judge.id = relationship.judge_id
    JOIN legal_case ON legal_case.id = relationship.case_id JOIN court ON court.id = legal_case.court_id
    WHERE judge.public_id = ${publicId} AND ${sql.unsafe(displayableCase)} ORDER BY legal_case.filed_on DESC NULLS LAST LIMIT 100
  `;
  return { ...judge, appointments, cases };
}

export async function getQualifiedCourt(sql: Sql, publicId: string): Promise<QualifiedCourtProfile | null> {
  const [court] = await sql<Array<Omit<QualifiedCourtProfile, "judges" | "cases">>>`
    SELECT court.public_id AS "publicId", court.name, court.short_name AS "shortName", court.jurisdiction,
      court.source_url AS "sourceUrl", court.verification::text AS verification,
      count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate",
      detail.court_level AS "courtLevel", detail.role_summary AS "roleSummary", detail.jurisdiction_summary AS "jurisdictionSummary",
      detail.geographic_scope AS "geographicScope", detail.official_source_url AS "detailSourceUrl", detail.verified_on::text AS "detailVerifiedOn",
      COALESCE((SELECT decision.indexable FROM publication_decision decision WHERE decision.object_type = 'court' AND decision.object_id = court.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false) AS indexable
    FROM court JOIN legal_case ON legal_case.court_id = court.id LEFT JOIN court_profile_detail detail ON detail.court_id = court.id
    WHERE court.public_id = ${publicId} AND court.verification = 'verified' AND court.source_url IS NOT NULL AND ${sql.unsafe(displayableCase)}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'court' AND decision.object_id = court.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY court.id, detail.court_id LIMIT 1
  `;
  if (!court) return null;
  const judges = await sql<QualifiedCourtProfile["judges"]>`
    SELECT judge.public_id, judge.display_name AS "displayName", appointment.position_title AS "positionTitle",
      appointment.service_started_on::text AS "serviceStartedOn", appointment.service_ended_on::text AS "serviceEndedOn"
    FROM judicial_appointment appointment JOIN judge ON judge.id = appointment.judge_id JOIN court ON court.id = appointment.court_id
    WHERE court.public_id = ${publicId} AND judge.verification = 'verified'
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'judge' AND decision.object_id = judge.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    ORDER BY appointment.service_ended_on DESC NULLS FIRST, judge.display_name
  `;
  const cases = await sql<QualifiedCourtProfile["cases"]>`SELECT legal_case.public_id, legal_case.caption, legal_case.docket_number AS "docketNumber", legal_case.filed_on::text AS "filedOn" FROM legal_case JOIN court ON court.id = legal_case.court_id WHERE court.public_id = ${publicId} AND ${sql.unsafe(displayableCase)} ORDER BY legal_case.filed_on DESC NULLS LAST LIMIT 100`;
  return { ...court, judges, cases };
}

