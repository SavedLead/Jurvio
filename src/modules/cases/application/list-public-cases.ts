import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { publishedCountSeedComplete, readPlannerPublishedEstimate } from "./published-count-seed";
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
  /** Newest-first cursor (decided-or-filed date, caption, id). Skips OFFSET. */
  before?: { on: string | null; caption: string; id: string } | null;
  /** Paid subscribers only: include subscriber-only (search-excluded, sealed-style) cases. */
  includeSubscriberOnly?: boolean;
}

/** True when the total is a slice of the corpus, not every published case. */
export function listingHasNarrowingFilter(options: Pick<
  ListPublicCasesOptions,
  "court" | "query" | "party" | "firm" | "decided" | "opinion" | "verified" | "fromYear" | "toYear"
>): boolean {
  return Boolean(
    options.court || options.query || options.party || options.firm || options.decided || options.opinion
      || options.verified || options.fromYear || options.toYear,
  );
}

/**
 * Published-case headline for the unfiltered listing. After every court has
 * been seeded, sums the running per-court counters
 * (court_public_stats.case_count). Until that seed finishes, uses the planner
 * estimate on the published-recency index so a partial seed cannot show a
 * mixed total. Neither path counts legal_case.
 */
export async function readCachedPublishedTotal(sql: Sql): Promise<number> {
  if (await publishedCountSeedComplete(sql)) {
    try {
      const [row] = await sql<{ total: string }[]>`
        SELECT coalesce(sum(case_count), 0)::bigint AS total
        FROM court_public_stats
      `;
      const total = Number(row?.total ?? 0);
      if (Number.isFinite(total) && total > 0) return total;
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "42P01") throw error;
    }
  }
  return readPlannerPublishedEstimate(sql);
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
 * Courts are stored once per provider (CourtListener, direct court feeds), so the
 * same court can appear under two names: "Court of Appeals for the Ninth Circuit"
 * and "United States Court of Appeals for the Ninth Circuit", or two rows both named
 * "Supreme Court of the United States". The facet groups courts by this key, and a
 * court filter matches every court with the same key.
 */
export function courtFacetKeySql(alias = "court") {
  return `regexp_replace(lower(regexp_replace(${alias}.name, '^\\s*(the\\s+)?(united\\s+states|u\\.\\s?s\\.)\\s+', '', 'i')), '[^a-z0-9]+', ' ', 'g')`;
}

/** Same normalization as courtFacetKeySql, for tests and callers outside SQL. */
export function courtFacetKey(name: string) {
  return name.replace(/^\s*(the\s+)?(united\s+states|u\.\s?s\.)\s+/i, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

/**
 * Court facet for /cases from court_public_stats (refreshed off the request
 * path by `public-directory-stats`). Duplicate court rows (see courtFacetKeySql)
 * are merged: the value is the busiest row's public id and the label the most
 * formal (longest) name. A missing stats table returns no facets. The live
 * GROUP BY over every published case stays available to tests and the refresher,
 * and is not used to render /cases.
 */
export async function listPublicCaseCourts(sql: Sql): Promise<CourtFacet[]> {
  try {
    return await sql<CourtFacet[]>`
      SELECT (array_agg(court.public_id ORDER BY stats.case_count DESC, court.public_id))[1] AS value,
        (array_agg(court.name ORDER BY length(court.name) DESC, stats.case_count DESC))[1] AS label,
        sum(stats.case_count)::int AS count
      FROM court_public_stats stats
      JOIN court ON court.id = stats.court_id
      WHERE stats.case_count > 0
      GROUP BY ${sql.unsafe(courtFacetKeySql())}
      ORDER BY count DESC, label
    `;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "42P01") throw error;
    return [];
  }
}

export async function listPublicCaseCourtsLive(sql: Sql): Promise<CourtFacet[]> {
  return sql<CourtFacet[]>`
    WITH per_court AS (
      SELECT court.id, court.public_id, court.name, count(*)::int AS case_count
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
    )
    SELECT (array_agg(court.public_id ORDER BY court.case_count DESC, court.public_id))[1] AS value,
      (array_agg(court.name ORDER BY length(court.name) DESC, court.case_count DESC))[1] AS label,
      sum(court.case_count)::int AS count
    FROM per_court court
    GROUP BY ${sql.unsafe(courtFacetKeySql())}
    ORDER BY count DESC, label
  `;
}

export async function listPublicCases(sql: Sql, options: ListPublicCasesOptions) {
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const courtFilter = clean(options.court);
  const query = clean(options.query);
  const party = clean(options.party);
  const firm = clean(options.firm);
  const queryPattern = query ? containsPattern(query) : null;
  const sort: CaseListingSort = options.sort === "best" && !query ? "recent" : options.sort ?? (query ? "best" : "recent");
  const narrowing = listingHasNarrowingFilter(options);
  // Unfiltered newest-first pages stay on legal_case_published_recency_idx.
  // Page 1 is LIMIT only. Later pages pass a keyset cursor and do not OFFSET.
  const recentKeyset = !narrowing && sort === "recent";
  const offset = recentKeyset ? 0 : (page - 1) * pageSize;

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
    sql`${sql.unsafe(latestPublicationColumnSql("displayable", "legal_case", "legal_case.id"))}`,
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
  // A court filter matches every stored row for the same court (see courtFacetKeySql).
  if (courtFilter) {
    conditions.push(sql`court.id IN (
      SELECT sibling.id FROM court sibling
      WHERE ${sql.unsafe(courtFacetKeySql("sibling"))} = (
        SELECT ${sql.unsafe(courtFacetKeySql("selected"))} FROM court selected WHERE selected.public_id = ${courtFilter}
      )
    )`);
  }
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
  // A future filed or decided date must not lead Most recent. The bound is the
  // same expression as legal_case_published_recency_idx.
  if ((sort === "recent" || sort === "oldest") && !query) {
    conditions.push(sql`(
      COALESCE(legal_case.decided_on, legal_case.filed_on) IS NULL
      OR COALESCE(legal_case.decided_on, legal_case.filed_on) <= (timezone('America/New_York', now()))::date
    )`);
  }
  if (options.fromYear) conditions.push(sql`COALESCE(legal_case.decided_on, legal_case.filed_on) >= make_date(${options.fromYear}::int, 1, 1)`);
  if (options.toYear) conditions.push(sql`COALESCE(legal_case.decided_on, legal_case.filed_on) < make_date(${options.toYear}::int + 1, 1, 1)`);
  const before = recentKeyset ? options.before ?? null : null;
  if (before) {
    const on = before.on;
    conditions.push(sql`(
      (${on}::date IS NOT NULL AND COALESCE(legal_case.decided_on, legal_case.filed_on) < ${on}::date)
      OR (
        COALESCE(legal_case.decided_on, legal_case.filed_on) IS NOT DISTINCT FROM ${on}::date
        AND (
          legal_case.caption > ${before.caption}
          OR (legal_case.caption = ${before.caption} AND legal_case.id > ${before.id}::uuid)
        )
      )
      OR (${on}::date IS NOT NULL AND COALESCE(legal_case.decided_on, legal_case.filed_on) IS NULL)
    )`);
  }

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
    narrowing
      ? sql<Array<{ total: number }>>`
          SELECT count(*)::int AS total
          FROM legal_case
          JOIN court ON court.id = legal_case.court_id
          WHERE ${where}
        `
      : readCachedPublishedTotal(sql).then((total) => [{ total }]),
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

  const last = rows.at(-1);
  const nextBefore = recentKeyset && rows.length === pageSize && last
    ? { on: last.decidedOn ?? last.filedOn, caption: last.caption, id: last.id }
    : null;

  return {
    cases,
    total: totals[0]?.total ?? 0,
    /** Unfiltered totals are the stats sum or a planner estimate, not a live count. */
    totalApproximate: !narrowing,
    nextBefore,
    page: recentKeyset ? 1 : page,
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
