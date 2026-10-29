import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface OpinionSearchResult {
  casePublicId: string;
  documentPublicId: string;
  caseCaption: string;
  courtName: string;
  title: string;
  filedOn: string | null;
  precedentialStatus: string | null;
  opinionType: string;
  citationCount: number;
  excerpt: string;
}

export type OpinionSearchSort = "relevance" | "newest" | "oldest" | "most-cited";
export interface OpinionSearchFilters {
  query: string;
  court?: string;
  dateFrom?: string;
  dateTo?: string;
  precedentialStatus?: string;
  opinionType?: string;
  sort: OpinionSearchSort;
  page: number;
}

export interface OpinionSearchFacets {
  courts: Array<{ value: string; label: string; count: number }>;
  precedentialStatuses: Array<{ value: string; label: string; count: number }>;
  opinionTypes: Array<{ value: string; label: string; count: number }>;
  timedOut?: boolean;
}

export interface OpinionSearchResponse {
  results: OpinionSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  /** The statement budget elapsed before any rows were returned. */
  timedOut?: boolean;
  /** Rows were returned, but the exact total did not finish in time. */
  countTimedOut?: boolean;
  /** The match set was capped so a common term does not rank the whole corpus. */
  totalCapped?: boolean;
}

export const OPINION_SEARCH_PAGE_SIZE = 20;
/** Stop the GIN scan after this many hits. Ranking every match of a common
 * word such as "securities" exceeds the statement budget on the live corpus. */
export const OPINION_SEARCH_CANDIDATE_CAP = 2_000;
/** Per statement, well under the ~60s edge timeout, above a cold-cache spike. */
export const OPINION_SEARCH_STATEMENT_TIMEOUT_MS = 8_000;

const TIMEOUT_MARK = "JURVIO_QUERY_TIMED_OUT";
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export class QueryTimedOutError extends Error {
  readonly response?: OpinionSearchResponse;

  constructor(readonly scope: "search" | "facets", response?: OpinionSearchResponse) {
    super(`${TIMEOUT_MARK}:${scope}`);
    this.name = "QueryTimedOutError";
    this.response = response;
  }
}

export function readQueryTimeout(error: unknown): { scope: "search" | "facets"; response?: OpinionSearchResponse } | null {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (current instanceof QueryTimedOutError) return { scope: current.scope, response: current.response };
    const record = current as { message?: unknown; cause?: unknown; reason?: unknown };
    if (typeof record.message === "string") {
      if (record.message.includes(`${TIMEOUT_MARK}:search`)) return { scope: "search" };
      if (record.message.includes(`${TIMEOUT_MARK}:facets`)) return { scope: "facets" };
    }
    if (record.cause) pending.push(record.cause);
    if (record.reason && record.reason !== record.cause) pending.push(record.reason);
  }
  return null;
}

export function isStatementTimeout(error: unknown): boolean {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "57014") return true;
    if (typeof record.message === "string" && record.message.toLowerCase().includes("statement timeout")) return true;
    if (record.cause) pending.push(record.cause);
  }
  return false;
}

export function timeoutSearchResponse(filters: OpinionSearchFilters): OpinionSearchResponse {
  return {
    results: [],
    total: 0,
    page: filters.page,
    pageSize: OPINION_SEARCH_PAGE_SIZE,
    timedOut: true,
  };
}

export function emptyOpinionSearchFacets(): OpinionSearchFacets {
  return { courts: [], precedentialStatuses: [], opinionTypes: [], timedOut: true };
}

export function responseForSearchError(filters: OpinionSearchFilters, error: unknown): OpinionSearchResponse | null {
  return isStatementTimeout(error) ? timeoutSearchResponse(filters) : null;
}

/** First meaningful token, used to anchor a cheap excerpt without ts_headline. */
export function excerptAnchor(query: string): string {
  const token = query
    .replace(/["']/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .find((part) => part.length >= 3);
  return (token ?? "").slice(0, 80);
}

export function interpretSettledSearch(
  filters: OpinionSearchFilters,
  search: PromiseSettledResult<OpinionSearchResponse>,
  facets: PromiseSettledResult<OpinionSearchFacets>,
): { response: OpinionSearchResponse; facets: OpinionSearchFacets } {
  if (search.status === "rejected") {
    const timeout = readQueryTimeout(search.reason);
    if (!timeout || timeout.scope !== "search") throw search.reason;
  }
  if (facets.status === "rejected") {
    const timeout = readQueryTimeout(facets.reason);
    if (!timeout || timeout.scope !== "facets") throw facets.reason;
  }
  return {
    response: search.status === "fulfilled" ? search.value : readQueryTimeout(search.reason)?.response ?? timeoutSearchResponse(filters),
    facets: facets.status === "fulfilled" ? facets.value : emptyOpinionSearchFacets(),
  };
}

export function normalizeOpinionSearchFilters(input: Record<string, string | undefined>): OpinionSearchFilters {
  const sort: OpinionSearchSort = ["relevance", "newest", "oldest", "most-cited"].includes(input.sort ?? "")
    ? input.sort as OpinionSearchSort : "relevance";
  const pageNumber = Number.parseInt(input.page ?? "1", 10);
  return {
    query: (input.q ?? "").trim().slice(0, 500),
    court: input.court?.trim().slice(0, 80) || undefined,
    dateFrom: input.from && isoDate.test(input.from) ? input.from : undefined,
    dateTo: input.to && isoDate.test(input.to) ? input.to : undefined,
    precedentialStatus: input.status?.trim().slice(0, 100) || undefined,
    opinionType: input.type?.trim().slice(0, 100) || undefined,
    sort,
    page: Number.isFinite(pageNumber) ? Math.min(Math.max(pageNumber, 1), 50) : 1,
  };
}

interface SearchHit {
  documentId: string;
  total?: number;
  matchedCount?: number;
}

interface SearchDetail extends OpinionSearchResult {
  documentId: string;
}

export function assertStatementTimeoutMs(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("statement timeout must be an integer from 1 to 30000 milliseconds");
  }
  return timeoutMs;
}

function statementTimeoutError(): Error {
  return Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
}

export async function withStatementTimeout<T>(sql: Sql, timeoutMs: number, run: (tx: Sql) => Promise<T>): Promise<T> {
  const ms = assertStatementTimeoutMs(timeoutMs);
  // Root clients expose begin(). A client that is already inside a transaction
  // (integration tests, and any caller holding a rollback) exposes savepoint() instead.
  const open = (sql.begin
    ? sql.begin.bind(sql)
    : (sql as { savepoint?: typeof sql.begin }).savepoint?.bind(sql)) as
    ((callback: (tx: Sql) => Promise<T>) => Promise<T>) | undefined;
  if (!open) throw new Error("SQL client cannot open a transaction");

  // Production keyword search kept running until Cloudflare's 60s 504 even with
  // set_config('statement_timeout', ..., true). Set the GUCs with a literal, and
  // if the HTTP budget expires first, cancel the backend so the page can return
  // the degraded response instead of waiting out the gateway.
  let backendPid: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (backendPid !== undefined) {
        void sql`SELECT pg_cancel_backend(${backendPid})`.catch(() => undefined);
      }
      reject(statementTimeoutError());
    }, ms + 750);
  });

  const work = open(async (tx) => {
    const query = tx as unknown as Sql;
    const [row] = await query<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
    backendPid = row?.pid;
    await query.unsafe(`SET LOCAL statement_timeout = '${ms}ms'`);
    await query.unsafe(`SET LOCAL lock_timeout = '${ms}ms'`);
    return run(query);
  });
  // If the deadline wins, the query can still reject later. Attach a handler so
  // that second rejection is not an unhandled promise rejection.
  work.catch(() => undefined);

  try {
    return await Promise.race([work, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyResponse(filters: OpinionSearchFilters): OpinionSearchResponse {
  return { results: [], total: 0, page: filters.page, pageSize: OPINION_SEARCH_PAGE_SIZE };
}

function projectionFilters(sql: Sql, filters: OpinionSearchFilters, courtId: string | null) {
  return sql`
    (${courtId}::uuid IS NULL OR projection.court_id = ${courtId}::uuid)
    AND (${filters.dateFrom ?? null}::date IS NULL OR projection.date_filed >= ${filters.dateFrom ?? null}::date)
    AND (${filters.dateTo ?? null}::date IS NULL OR projection.date_filed <= ${filters.dateTo ?? null}::date)
    AND (${filters.precedentialStatus ?? null}::text IS NULL OR projection.precedential_status = ${filters.precedentialStatus ?? null})
    AND (${filters.opinionType ?? null}::text IS NULL OR projection.opinion_type = ${filters.opinionType ?? null})
  `;
}

function metaFilters(sql: Sql, filters: OpinionSearchFilters, courtId: string | null) {
  return sql`
    meta.visible
    AND (${courtId}::uuid IS NULL OR meta.court_id = ${courtId}::uuid)
    AND (${filters.dateFrom ?? null}::date IS NULL OR meta.date_filed >= ${filters.dateFrom ?? null}::date)
    AND (${filters.dateTo ?? null}::date IS NULL OR meta.date_filed <= ${filters.dateTo ?? null}::date)
    AND (${filters.precedentialStatus ?? null}::text IS NULL OR meta.precedential_status = ${filters.precedentialStatus ?? null})
    AND (${filters.opinionType ?? null}::text IS NULL OR meta.opinion_type = ${filters.opinionType ?? null})
  `;
}

function metaOrdering(sql: Sql, sort: OpinionSearchSort) {
  if (sort === "oldest") return sql`meta.date_filed ASC NULLS LAST, meta.citation_count DESC, meta.document_id`;
  if (sort === "most-cited") return sql`meta.citation_count DESC, meta.date_filed DESC NULLS LAST, meta.document_id`;
  return sql`meta.date_filed DESC NULLS LAST, meta.citation_count DESC, meta.document_id`;
}

function keywordOrdering(sql: Sql, sort: OpinionSearchSort) {
  if (sort === "newest") return sql`visible.date_filed DESC NULLS LAST, visible.citation_count DESC, visible.document_id`;
  if (sort === "oldest") return sql`visible.date_filed ASC NULLS LAST, visible.citation_count DESC, visible.document_id`;
  if (sort === "most-cited") return sql`visible.citation_count DESC, visible.date_filed DESC NULLS LAST, visible.document_id`;
  return sql`visible.caption_rank DESC, visible.citation_count DESC, visible.date_filed DESC NULLS LAST, visible.document_id`;
}

async function resolveCourtId(sql: Sql, court: string | undefined): Promise<string | null | undefined> {
  if (!court) return null;
  const [row] = await sql<{ id: string }[]>`SELECT id FROM court WHERE public_id = ${court} LIMIT 1`;
  return row?.id;
}

async function hydrateHits(sql: Sql, hits: SearchHit[], anchor: string): Promise<OpinionSearchResult[]> {
  if (hits.length === 0) return [];
  const ids = hits.map((hit) => hit.documentId);
  const details = await sql<SearchDetail[]>`
    SELECT
      document.public_id AS "documentPublicId",
      legal_case.public_id AS "casePublicId",
      projection.document_id AS "documentId",
      projection.title,
      projection.case_caption AS "caseCaption",
      projection.court_name AS "courtName",
      projection.date_filed::text AS "filedOn",
      projection.precedential_status AS "precedentialStatus",
      projection.opinion_type AS "opinionType",
      projection.citation_count AS "citationCount",
      regexp_replace(btrim(
        CASE
          WHEN located.anchor_at > 140 THEN '… ' || substring(projection.body from located.anchor_at - 140 for 340)
          WHEN located.anchor_at > 0 THEN substring(projection.body from 1 for 340)
          ELSE left(projection.body, 300)
        END
      ), '[[:space:]]+', ' ', 'g') AS excerpt
    FROM opinion_search_projection projection
    JOIN document ON document.id = projection.document_id
    JOIN legal_case ON legal_case.id = projection.case_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN ${anchor} = '' THEN 0
        ELSE strpos(lower(projection.body), lower(${anchor}))
      END AS anchor_at
    ) located
    WHERE projection.document_id IN ${sql(ids)}
  `;
  const order = new Map(hits.map((hit, index) => [hit.documentId, index]));
  return details
    .sort((left, right) => (order.get(left.documentId) ?? 0) - (order.get(right.documentId) ?? 0))
    .map((detail) => ({
      casePublicId: detail.casePublicId,
      documentPublicId: detail.documentPublicId,
      caseCaption: detail.caseCaption,
      courtName: detail.courtName,
      title: detail.title,
      filedOn: detail.filedOn,
      precedentialStatus: detail.precedentialStatus,
      opinionType: detail.opinionType,
      citationCount: detail.citationCount,
      excerpt: detail.excerpt,
    }));
}

export async function searchPublicOpinions(
  sql: Sql,
  filters: OpinionSearchFilters,
  options?: { statementTimeoutMs?: number },
): Promise<OpinionSearchResponse> {
  const pageSize = OPINION_SEARCH_PAGE_SIZE;
  const offset = (filters.page - 1) * pageSize;
  const hasQuery = filters.query.length >= 2;
  const hasSearch = hasQuery || Boolean(filters.court || filters.dateFrom || filters.dateTo || filters.precedentialStatus || filters.opinionType);
  if (!hasSearch) return emptyResponse(filters);

  const timeoutMs = options?.statementTimeoutMs ?? OPINION_SEARCH_STATEMENT_TIMEOUT_MS;
  try {
    return await withStatementTimeout(sql, timeoutMs, async (tx) => {
      const courtId = await resolveCourtId(tx, filters.court);
      if (courtId === undefined) return emptyResponse(filters);
      // A sequential scan applies @@ by detoasting every stored opinion vector.
      // The planner will pick that over the GIN index when it thinks a term is
      // common, which is the production timeout. Prefer the index for keyword search.
      if (hasQuery) await tx`SELECT set_config('enable_seqscan', 'off', true)`;

      const hits: { rows: SearchHit[]; total: number; countTimedOut?: boolean; totalCapped?: boolean } = hasQuery
        ? await keywordHits(tx, filters, courtId, pageSize, offset)
        : await filterHits(tx, filters, courtId, pageSize, offset);
      const results = await hydrateHits(tx, hits.rows, hasQuery ? excerptAnchor(filters.query) : "");
      return {
        results,
        total: hits.total,
        page: filters.page,
        pageSize,
        countTimedOut: hits.countTimedOut,
        totalCapped: hits.totalCapped,
      };
    });
  } catch (error) {
    const degraded = responseForSearchError(filters, error);
    if (degraded) return degraded;
    throw error;
  }
}

async function keywordHits(
  sql: Sql,
  filters: OpinionSearchFilters,
  courtId: string | null,
  pageSize: number,
  offset: number,
): Promise<{ rows: SearchHit[]; total: number; countTimedOut?: boolean; totalCapped?: boolean }> {
  // Rank only the short caption and title. ts_rank_cd on the stored body vector
  // has to detoast every hit, which is what blows the time budget for a common term.
  // The GIN index still decides which rows match, including body-only matches.
  const rank = filters.sort === "relevance"
    ? sql`ts_rank_cd(
        setweight(to_tsvector('english', coalesce(projection.case_caption, '')), 'A')
        || setweight(to_tsvector('english', coalesce(projection.title, '')), 'A'),
        websearch_to_tsquery('english', ${filters.query})
      )`
    : sql`0::real`;
  const filtersOnProjection = projectionFilters(sql, filters, courtId);
  const hits = await sql<SearchHit[]>`
    WITH matched AS MATERIALIZED (
      SELECT
        projection.document_id,
        projection.citation_count,
        projection.date_filed,
        ${rank} AS caption_rank
      FROM opinion_search_projection projection
      WHERE projection.search_vector @@ websearch_to_tsquery('english', ${filters.query})
        AND ${filtersOnProjection}
      LIMIT ${OPINION_SEARCH_CANDIDATE_CAP}
    ),
    visible AS MATERIALIZED (
      SELECT
        matched.document_id,
        matched.citation_count,
        matched.date_filed,
        matched.caption_rank,
        (count(*) OVER ())::int AS total,
        (SELECT count(*)::int FROM matched) AS "matchedCount"
      FROM matched
      JOIN opinion_search_meta meta
        ON meta.document_id = matched.document_id
       AND meta.visible
    )
    SELECT visible.document_id AS "documentId", visible.total, visible."matchedCount"
    FROM visible
    ORDER BY ${keywordOrdering(sql, filters.sort)}
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  if (hits.length > 0) {
    return {
      rows: hits,
      total: hits[0]?.total ?? hits.length,
      totalCapped: (hits[0]?.matchedCount ?? 0) >= OPINION_SEARCH_CANDIDATE_CAP,
    };
  }
  if (offset === 0) return { rows: [], total: 0 };

  const [count] = await sql<{ value: number }[]>`
    WITH matched AS MATERIALIZED (
      SELECT projection.document_id
      FROM opinion_search_projection projection
      WHERE projection.search_vector @@ websearch_to_tsquery('english', ${filters.query})
        AND ${projectionFilters(sql, filters, courtId)}
      LIMIT ${OPINION_SEARCH_CANDIDATE_CAP}
    )
    SELECT count(*)::int AS value
    FROM matched
    JOIN opinion_search_meta meta
      ON meta.document_id = matched.document_id
     AND meta.visible
  `;
  return { rows: [], total: count?.value ?? 0 };
}

async function filterHits(
  sql: Sql,
  filters: OpinionSearchFilters,
  courtId: string | null,
  pageSize: number,
  offset: number,
): Promise<{ rows: SearchHit[]; total: number }> {
  const rows = await sql<SearchHit[]>`
    SELECT meta.document_id AS "documentId"
    FROM opinion_search_meta meta
    WHERE ${metaFilters(sql, filters, courtId)}
    ORDER BY ${metaOrdering(sql, filters.sort)}
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const [count] = await sql<{ value: number }[]>`
    SELECT count(*)::int AS value
    FROM opinion_search_meta meta
    WHERE ${metaFilters(sql, filters, courtId)}
  `;
  return { rows, total: count?.value ?? 0 };
}

export async function listOpinionSearchFacets(
  sql: Sql,
  options?: { statementTimeoutMs?: number },
): Promise<OpinionSearchFacets> {
  const timeoutMs = options?.statementTimeoutMs ?? OPINION_SEARCH_STATEMENT_TIMEOUT_MS;
  try {
    return await withStatementTimeout(sql, timeoutMs, async (tx) => {
      // One connection, in order. These scans read the narrow meta table only.
      const courts = await tx<OpinionSearchFacets["courts"]>`
        SELECT court.public_id AS value, court.name AS label, count(*)::int AS count
        FROM opinion_search_meta meta
        JOIN court ON court.id = meta.court_id
        WHERE meta.visible
        GROUP BY court.id
        ORDER BY count DESC, court.name
        LIMIT 100`;
      const statuses = await tx<OpinionSearchFacets["precedentialStatuses"]>`
        SELECT meta.precedential_status AS value, meta.precedential_status AS label, count(*)::int AS count
        FROM opinion_search_meta meta
        WHERE meta.visible AND meta.precedential_status IS NOT NULL
        GROUP BY meta.precedential_status
        ORDER BY count DESC, value`;
      const types = await tx<OpinionSearchFacets["opinionTypes"]>`
        SELECT meta.opinion_type AS value, meta.opinion_type AS label, count(*)::int AS count
        FROM opinion_search_meta meta
        WHERE meta.visible
        GROUP BY meta.opinion_type
        ORDER BY count DESC, value`;
      return { courts, precedentialStatuses: statuses, opinionTypes: types };
    });
  } catch (error) {
    if (isStatementTimeout(error)) return emptyOpinionSearchFacets();
    throw error;
  }
}
