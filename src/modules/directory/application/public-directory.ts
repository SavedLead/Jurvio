import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { isMissingTable } from "./public-directory-stats";

type Sql = ReturnType<typeof postgres>;

export function canIndexDirectoryProfile(input: { indexable: boolean; verification: string }): boolean {
  return input.indexable && input.verification === "verified";
}

export interface DirectoryEntitySummary {
  publicId: string;
  displayName: string;
  entityType: string;
  caseCount: number;
  latestCaseDate: string | null;
}

export interface DirectoryEntityProfile extends DirectoryEntitySummary {
  verification: string;
  indexable: boolean;
  appearances: Array<{
    casePublicId: string;
    caption: string;
    docketNumber: string;
    courtName: string;
    role: string;
    nameAsFiled: string;
    filedOn: string | null;
  }>;
}

export interface CourtDirectorySummary {
  publicId: string;
  name: string;
  shortName: string | null;
  jurisdiction: string | null;
  caseCount: number;
  latestCaseDate: string | null;
}

export interface CourtDirectoryProfile extends CourtDirectorySummary {
  sourceUrl: string | null;
  verification: string;
  indexable: boolean;
  cases: Array<{
    publicId: string;
    caption: string;
    docketNumber: string;
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

export async function listPublicEntities(
  sql: Sql,
  entityType: "party" | "law_firm",
  limit = 50,
): Promise<DirectoryEntitySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const typeClause = entityType === "party"
    ? sql`entity.entity_type IN ('unknown', 'person', 'organization', 'agency')`
    : sql`entity.entity_type = 'law_firm'`;

  return sql<DirectoryEntitySummary[]>`
    SELECT entity.public_id AS "publicId", entity.display_name AS "displayName",
      entity.entity_type AS "entityType", count(DISTINCT legal_case.id)::int AS "caseCount",
      max(legal_case.filed_on)::text AS "latestCaseDate"
    FROM entity
    JOIN party_appearance appearance ON appearance.entity_id = entity.id
    JOIN legal_case ON legal_case.id = appearance.case_id
    WHERE ${typeClause}
      AND ${sql.unsafe(displayableCase)}
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), true)
    GROUP BY entity.id
    ORDER BY count(DISTINCT legal_case.id) DESC, entity.display_name, entity.public_id
    LIMIT ${safeLimit}
  `;
}

export async function getPublicEntity(
  sql: Sql,
  publicId: string,
  expectedType: "party" | "law_firm",
): Promise<DirectoryEntityProfile | null> {
  const typeClause = expectedType === "party"
    ? sql`entity.entity_type IN ('unknown', 'person', 'organization', 'agency')`
    : sql`entity.entity_type = 'law_firm'`;
  const [entity] = await sql<Array<Omit<DirectoryEntityProfile, "appearances">>>`
    SELECT entity.public_id AS "publicId", entity.display_name AS "displayName",
      entity.entity_type AS "entityType", entity.verification::text AS verification,
      count(DISTINCT legal_case.id)::int AS "caseCount",
      max(legal_case.filed_on)::text AS "latestCaseDate",
      COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false) AS indexable
    FROM entity
    JOIN party_appearance appearance ON appearance.entity_id = entity.id
    JOIN legal_case ON legal_case.id = appearance.case_id
    WHERE entity.public_id = ${publicId} AND ${typeClause}
      AND ${sql.unsafe(displayableCase)}
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), true)
    GROUP BY entity.id
    LIMIT 1
  `;
  if (!entity) return null;

  const appearances = await sql<DirectoryEntityProfile["appearances"]>`
    SELECT legal_case.public_id AS "casePublicId", legal_case.caption,
      legal_case.docket_number AS "docketNumber", court.name AS "courtName",
      appearance.role, appearance.party_name_as_filed AS "nameAsFiled",
      legal_case.filed_on::text AS "filedOn"
    FROM party_appearance appearance
    JOIN entity ON entity.id = appearance.entity_id
    JOIN legal_case ON legal_case.id = appearance.case_id
    JOIN court ON court.id = legal_case.court_id
    WHERE entity.public_id = ${publicId} AND ${sql.unsafe(displayableCase)}
    ORDER BY legal_case.filed_on DESC NULLS LAST, legal_case.caption, appearance.role
    LIMIT 100
  `;
  return { ...entity, appearances };
}

const displayableCourt = `
  COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'court' AND decision.object_id = court.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), true)
`;

/**
 * Court directory from court_public_stats (refreshed by the citations-lane
 * `public-directory-stats` job). Falls back to the live GROUP BY when the
 * table is missing or not refreshed yet.
 */
export async function listPublicCourts(sql: Sql, limit = 100): Promise<CourtDirectorySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  try {
    const rows = await sql<CourtDirectorySummary[]>`
      SELECT court.public_id AS "publicId", court.name, court.short_name AS "shortName",
        court.jurisdiction, stats.case_count AS "caseCount",
        stats.latest_case_date::text AS "latestCaseDate"
      FROM court_public_stats stats
      JOIN court ON court.id = stats.court_id
      WHERE stats.case_count > 0
        AND ${sql.unsafe(displayableCourt)}
      ORDER BY stats.case_count DESC, court.name
      LIMIT ${safeLimit}
    `;
    if (rows.length) return rows;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return listPublicCourtsLive(sql, safeLimit);
}

export async function listPublicCourtsLive(sql: Sql, limit = 100): Promise<CourtDirectorySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return sql<CourtDirectorySummary[]>`
    SELECT court.public_id AS "publicId", court.name, court.short_name AS "shortName",
      court.jurisdiction, count(legal_case.id)::int AS "caseCount",
      max(legal_case.filed_on)::text AS "latestCaseDate"
    FROM court JOIN legal_case ON legal_case.court_id = court.id
    WHERE ${sql.unsafe(displayableCase)}
      AND ${sql.unsafe(displayableCourt)}
    GROUP BY court.id
    ORDER BY count(legal_case.id) DESC, court.name
    LIMIT ${safeLimit}
  `;
}

const visibleCaseById = latestPublicationColumnSql("displayable", "legal_case", "legal_case.id");

/**
 * Court profile. The count, latest date and newest-100 list come from
 * court_public_stats; the court row, its gate and each listed case's
 * visibility are read live, so an unpublished case never shows. A court with
 * no stats row (new court, table not migrated) uses the live query.
 */
export async function getPublicCourt(sql: Sql, publicId: string): Promise<CourtDirectoryProfile | null> {
  type Row = Omit<CourtDirectoryProfile, "cases" | "caseCount" | "latestCaseDate"> & {
    caseCount: number | null; latestCaseDate: string | null; recentCaseIds: string[] | null;
  };
  let court: Row | undefined;
  try {
    [court] = await sql<Row[]>`
      SELECT court.public_id AS "publicId", court.name, court.short_name AS "shortName",
        court.jurisdiction, court.source_url AS "sourceUrl", court.verification::text AS verification,
        stats.case_count AS "caseCount", stats.latest_case_date::text AS "latestCaseDate",
        stats.recent_case_ids::text[] AS "recentCaseIds",
        COALESCE((
          SELECT decision.indexable FROM publication_decision decision
          WHERE decision.object_type = 'court' AND decision.object_id = court.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false) AS indexable
      FROM court
      LEFT JOIN court_public_stats stats ON stats.court_id = court.id
      WHERE court.public_id = ${publicId}
        AND ${sql.unsafe(displayableCourt)}
      LIMIT 1
    `;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return getPublicCourtLive(sql, publicId);
  }
  if (!court) return null;
  if (court.caseCount === null || court.recentCaseIds === null) return getPublicCourtLive(sql, publicId);
  if (court.caseCount === 0) return null;
  const { recentCaseIds, caseCount, ...profile } = court;
  const cases = recentCaseIds.length ? await sql<CourtDirectoryProfile["cases"]>`
    SELECT legal_case.public_id AS "publicId", legal_case.caption,
      legal_case.docket_number AS "docketNumber", legal_case.filed_on::text AS "filedOn"
    FROM unnest(${recentCaseIds}::uuid[]) WITH ORDINALITY AS recent(id, ord)
    JOIN legal_case ON legal_case.id = recent.id
    WHERE legal_case.publication = 'published'
      AND ${sql.unsafe(visibleCaseById)}
    ORDER BY recent.ord
  ` : [];
  return { ...profile, caseCount, cases };
}

export async function getPublicCourtLive(sql: Sql, publicId: string): Promise<CourtDirectoryProfile | null> {
  const [court] = await sql<Array<Omit<CourtDirectoryProfile, "cases">>>`
    SELECT court.public_id AS "publicId", court.name, court.short_name AS "shortName",
      court.jurisdiction, court.source_url AS "sourceUrl", court.verification::text AS verification,
      count(legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate",
      COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'court' AND decision.object_id = court.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false) AS indexable
    FROM court JOIN legal_case ON legal_case.court_id = court.id
    WHERE court.public_id = ${publicId} AND ${sql.unsafe(displayableCase)}
      AND ${sql.unsafe(displayableCourt)}
    GROUP BY court.id LIMIT 1
  `;
  if (!court) return null;
  const cases = await sql<CourtDirectoryProfile["cases"]>`
    SELECT legal_case.public_id AS "publicId", legal_case.caption,
      legal_case.docket_number AS "docketNumber", legal_case.filed_on::text AS "filedOn"
    FROM legal_case JOIN court ON court.id = legal_case.court_id
    WHERE court.public_id = ${publicId} AND ${sql.unsafe(displayableCase)}
    ORDER BY legal_case.filed_on DESC NULLS LAST, legal_case.caption LIMIT 100
  `;
  return { ...court, cases };
}
