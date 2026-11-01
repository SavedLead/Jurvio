import type postgres from "postgres";
import { publicCaseSearchReady } from "./public-case-search";
import { readableOpinionExistsSql } from "@/modules/cases/domain/readable-opinion";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import type { CaseListingSort } from "@/modules/cases/domain/case-listing";

type Sql = ReturnType<typeof postgres>;

export interface PublicCaseListItem {
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn: string | null;
  supremeCourtTerm: number | null;
  officialCitation: string | null;
  courtName: string;
  hasPublicDocument: boolean;
  verification: string;
  latestEntryOn: string | null;
  latestEntryDescription: string | null;
  opinionAuthor: string | null;
  perCuriam: boolean;
  holding: string | null;
  /** Verified, public judges assigned to the case as an opinion author. */
  authorJudges: AuthorJudgeCandidate[];
}

export interface AuthorJudgeCandidate {
  publicId: string;
  displayName: string;
  normalizedName: string;
}

interface PublicCaseRow {
  id: string;
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn: string | null;
  supremeCourtTerm: number | null;
  officialCitation: string | null;
  courtName: string;
  hasPublicDocument: boolean;
  verification: string;
}

interface PublicCaseDetailRow {
  id: string;
  latestEntryOn: string | null;
  latestEntryDescription: string | null;
  opinionAuthor: string | null;
  perCuriam: boolean;
  holding: string | null;
  authorJudges: AuthorJudgeCandidate[];
}

export interface CourtFacet {
  value: string;
  label: string;
  count: number;
}

export interface ListPublicCasesOptions {
  page: number;
  pageSize: number;
  court?: string | null;
  query?: string | null;
  party?: string | null;
  firm?: string | null;
  decided?: boolean;
  opinion?: boolean;
  verified?: boolean;
  fromYear?: number | null;
  toYear?: number | null;
  sort?: CaseListingSort;
  /** Paid subscribers only: include subscriber-only (search-excluded, sealed-style) cases. */
  includeSubscriberOnly?: boolean;
}

/** Escapes LIKE wildcards so user text is matched literally. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function containsPattern(value: string) {
  return `%${escapeLike(value)}%`;
}

function clean(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") || null;
}

/**
 * Court facet for /cases from court_public_stats (refreshed off the request
 * path by `public-directory-stats`). Falls back to the live GROUP BY over every
 * published case when the table is missing or not refreshed yet.
 */
export async function listPublicCaseCourts(sql: Sql): Promise<CourtFacet[]> {
  try {
    const rows = await sql<CourtFacet[]>`
      SELECT court.public_id AS value, court.name AS label, stats.case_count AS count
      FROM court_public_stats stats
      JOIN court ON court.id = stats.court_id
      WHERE stats.case_count > 0
      ORDER BY stats.case_count DESC, court.name
    `;
    if (rows.length) return rows;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "42P01") throw error;
  }
  return listPublicCaseCourtsLive(sql);
}

export async function listPublicCaseCourtsLive(sql: Sql): Promise<CourtFacet[]> {
  return sql<CourtFacet[]>`
    SELECT court.public_id AS value, court.name AS label, count(*)::int AS count
    FROM legal_case
    JOIN court ON court.id = legal_case.court_id
    WHERE legal_case.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable
        FROM publication_decision decision
        WHERE decision.object_type = 'legal_case'
          AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC
        LIMIT 1
      ), false)
    GROUP BY court.id, court.public_id, court.name
    ORDER BY count DESC, court.name
  `;
}

export async function listPublicCases(sql: Sql, options: ListPublicCasesOptions) {
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const offset = (page - 1) * pageSize;
  const courtFilter = clean(options.court);
  const query = clean(options.query);
  const party = clean(options.party);
  const firm = clean(options.firm);
  const queryPattern = query ? containsPattern(query) : null;
  const sort: CaseListingSort = options.sort === "best" && !query ? "recent" : options.sort ?? (query ? "best" : "recent");

  const displayableEntity = sql`
    COALESCE((
      SELECT decision.displayable FROM publication_decision decision
      WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
      ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
    ), true)
  `;

  const publicDocumentExists = sql`${sql.unsafe(readableOpinionExistsSql("legal_case"))}`;

  const conditions = [
    sql`legal_case.publication = 'published'`,
    sql`COALESCE((
      SELECT decision.displayable
      FROM publication_decision decision
      WHERE decision.object_type = 'legal_case'
        AND decision.object_id = legal_case.id
      ORDER BY decision.decided_at DESC, decision.id DESC
      LIMIT 1
    ), false)`,
  ];
  if (queryPattern) {
    conditions.push(sql`(
      legal_case.caption ILIKE ${queryPattern}
      OR legal_case.docket_number ILIKE ${queryPattern}
      OR legal_case.official_citation ILIKE ${queryPattern}
      OR EXISTS (
        SELECT 1
        FROM scotus_case_enrichment enrichment
        WHERE enrichment.case_id = legal_case.id
          AND enrichment.verification = 'verified'
          AND enrichment.exact_holding ILIKE ${queryPattern}
      )
      OR EXISTS (
        SELECT 1
        FROM party_appearance
        JOIN entity ON entity.id = party_appearance.entity_id
        WHERE party_appearance.case_id = legal_case.id
          AND (
            party_appearance.party_name_as_filed ILIKE ${queryPattern}
            OR entity.display_name ILIKE ${queryPattern}
          )
      )
    )`);
  }
  // Free text: narrow to precomputed trigram candidates first (public_case_search,
  // a superset of every text condition here), then apply the exact conditions
  // below to those ids only. Until the first full sweep has completed, the live
  // conditions run alone.
  const textPatterns = [queryPattern, party ? containsPattern(party) : null, firm ? containsPattern(firm) : null]
    .filter((pattern): pattern is string => pattern !== null);
  if (textPatterns.length && await publicCaseSearchReady(sql)) {
    for (const pattern of textPatterns) {
      conditions.push(sql`legal_case.id = ANY(ARRAY(
        SELECT search.case_id FROM public_case_search search WHERE search.search_text ILIKE ${pattern}
      ))`);
    }
  }
  // Subscriber-only records (sealed-style captions, court-restricted events) are
  // listed only for paid subscribers; anonymous and Free views never include them.
  if (!options.includeSubscriberOnly) conditions.push(sql`NOT ${sql.unsafe(searchExcludedCaseSql("legal_case"))}`);
  if (courtFilter) conditions.push(sql`court.public_id = ${courtFilter}`);
  if (party) {
    const pattern = containsPattern(party);
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM party_appearance appearance
      JOIN entity ON entity.id = appearance.entity_id
      WHERE appearance.case_id = legal_case.id
        AND entity.entity_type <> 'law_firm'
        AND (appearance.party_name_as_filed ILIKE ${pattern} OR entity.display_name ILIKE ${pattern})
        AND ${displayableEntity}
    )`);
  }
  if (firm) {
    const pattern = containsPattern(firm);
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM party_appearance appearance
      JOIN entity ON entity.id = appearance.entity_id
      WHERE appearance.case_id = legal_case.id
        AND entity.entity_type = 'law_firm'
        AND entity.display_name ILIKE ${pattern}
        AND ${displayableEntity}
    )`);
  }
  if (options.decided) conditions.push(sql`legal_case.decided_on IS NOT NULL`);
  if (options.verified) conditions.push(sql`legal_case.verification = 'verified'`);
  if (options.opinion) conditions.push(publicDocumentExists);
  if (options.fromYear) conditions.push(sql`COALESCE(legal_case.decided_on, legal_case.filed_on) >= make_date(${options.fromYear}::int, 1, 1)`);
  if (options.toYear) conditions.push(sql`COALESCE(legal_case.decided_on, legal_case.filed_on) < make_date(${options.toYear}::int + 1, 1, 1)`);

  const where = conditions.reduce((combined, condition) => sql`${combined} AND ${condition}`);

  const ordering = sort === "best" && query
    ? sql`
      CASE
        WHEN legal_case.docket_number ILIKE ${escapeLike(query)} THEN 0
        WHEN legal_case.official_citation ILIKE ${`${escapeLike(query)}%`} THEN 0
        WHEN legal_case.caption ILIKE ${queryPattern} THEN 1
        ELSE 2
      END,
      COALESCE(legal_case.decided_on, legal_case.filed_on) DESC NULLS LAST,
      legal_case.caption, legal_case.id`
    : sort === "oldest"
      ? sql`COALESCE(legal_case.decided_on, legal_case.filed_on) ASC NULLS LAST, legal_case.caption, legal_case.id`
      : sort === "az"
        ? sql`legal_case.caption, legal_case.id`
        : sql`COALESCE(legal_case.decided_on, legal_case.filed_on) DESC NULLS LAST, legal_case.caption, legal_case.id`;

  const [totals, rows] = await Promise.all([
    sql<Array<{ total: number }>>`
      SELECT count(*)::int AS total
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE ${where}
    `,
    sql<PublicCaseRow[]>`
      SELECT legal_case.id::text AS id,
        legal_case.public_id AS "publicId",
        legal_case.caption,
        legal_case.docket_number AS "docketNumber",
        legal_case.filed_on::text AS "filedOn",
        legal_case.decided_on::text AS "decidedOn",
        legal_case.supreme_court_term AS "supremeCourtTerm",
        legal_case.official_citation AS "officialCitation",
        court.name AS "courtName",
        legal_case.verification::text AS verification,
        ${publicDocumentExists} AS "hasPublicDocument"
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE ${where}
      ORDER BY ${ordering}
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  ]);

  const details = rows.length ? await listPublicCaseDetails(sql, rows.map((row) => row.id)) : new Map<string, PublicCaseDetailRow>();
  const cases: PublicCaseListItem[] = rows.map(({ id, ...row }) => {
    const detail = details.get(id);
    return {
      ...row,
      latestEntryOn: detail?.latestEntryOn ?? null,
      latestEntryDescription: detail?.latestEntryDescription ?? null,
      opinionAuthor: detail?.opinionAuthor ?? null,
      perCuriam: detail?.perCuriam ?? false,
      holding: detail?.holding ?? null,
      authorJudges: detail?.authorJudges ?? [],
    };
  });

  return {
    cases,
    total: totals[0]?.total ?? 0,
    page,
    pageSize,
    court: courtFilter,
    query,
    sort,
  };
}

/**
 * Loads the per-row details shown on the listing for one page of cases only, using
 * the same publication gates as the case page: the latest dated public docket
 * entry, the primary readable opinion's author, the verified holding, and the
 * verified public judges assigned to the case as opinion authors.
 */
async function listPublicCaseDetails(sql: Sql, caseIds: string[]) {
  const rows = await sql<PublicCaseDetailRow[]>`
    SELECT legal_case.id::text AS id,
      latest_entry.filed_on::text AS "latestEntryOn",
      latest_entry.description AS "latestEntryDescription",
      primary_opinion.author_name AS "opinionAuthor",
      COALESCE(primary_opinion.per_curiam, false) AS "perCuriam",
      enrichment.exact_holding AS holding,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'publicId', judge.public_id,
          'displayName', judge.display_name,
          'normalizedName', judge.normalized_name
        ) ORDER BY judge.public_id), '[]'::json)
        FROM (
          SELECT DISTINCT judge.public_id, judge.display_name, judge.normalized_name
          FROM judge_case_assignment assignment
          JOIN judge ON judge.id = assignment.judge_id
          WHERE assignment.case_id = legal_case.id
            AND assignment.assignment_role = 'opinion_author'
            AND judge.verification = 'verified'
            AND COALESCE((
              SELECT decision.displayable FROM publication_decision decision
              WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
              ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
            ), false)
        ) judge
      ) AS "authorJudges"
    FROM legal_case
    LEFT JOIN scotus_case_enrichment enrichment
      ON enrichment.case_id = legal_case.id AND enrichment.verification = 'verified'
    LEFT JOIN LATERAL (
      SELECT entry.filed_on, entry.description
      FROM docket_entry entry
      WHERE entry.case_id = legal_case.id
        AND entry.filed_on IS NOT NULL
        AND COALESCE((
          SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type = 'docket_entry' AND decision.object_id = entry.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false)
      ORDER BY entry.filed_on DESC, entry.entry_number DESC NULLS LAST
      LIMIT 1
    ) latest_entry ON true
    LEFT JOIN LATERAL (
      SELECT judicial.author_name, judicial.per_curiam
      FROM document
      JOIN document_content content ON content.document_id = document.id
      LEFT JOIN judicial_opinion judicial ON judicial.document_id = document.id
      WHERE document.case_id = legal_case.id
        AND document.publication = 'published'
        AND (judicial.opinion_type IS NOT NULL OR document.document_type LIKE '%opinion%')
        AND COALESCE((
          SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type = 'document' AND decision.object_id = document.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false)
      ORDER BY document.filed_on DESC NULLS LAST, document.title
      LIMIT 1
    ) primary_opinion ON true
    WHERE legal_case.id IN ${sql(caseIds)}
  `;
  return new Map(rows.map((row) => [row.id, row]));
}
