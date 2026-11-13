import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
import { conditionalRequestHeaders, type HttpValidators } from "../http-validators";
import {
  courtListenerDocketSchema,
  courtListenerDocketEntryPageSchema,
  courtListenerOpinionClusterSchema,
  courtListenerOpinionClusterPageSchema,
  courtListenerOpinionSchema,
  courtListenerPageSchema,
  courtListenerPartyPageSchema,
  type CourtListenerDocket,
  type CourtListenerDocketEntry,
  type CourtListenerOpinion,
  type CourtListenerOpinionCluster,
  type CourtListenerParty,
} from "./schema";

export class CourtListenerNotModified extends Error {
  readonly sourceUri: string;
  readonly etag?: string;
  readonly lastModified?: string;

  constructor(sourceUri: string, etag?: string | null, lastModified?: string | null) {
    super("CourtListener resource not modified");
    this.name = "CourtListenerNotModified";
    this.sourceUri = sourceUri;
    this.etag = etag ?? undefined;
    this.lastModified = lastModified ?? undefined;
  }
}

/**
 * CourtListener answered 429. Thrown instead of sleeping when the caller asked to
 * stop on rate limits, or when honoring Retry-After would run past the deadline.
 */
export class CourtListenerRateLimited extends Error {
  readonly retryAfterMs: number | null;

  constructor(retryAfterMs: number | null) {
    super(
      `CourtListener rate limited (429)${retryAfterMs === null ? "" : `; retry after ${Math.ceil(retryAfterMs / 1000)}s`}`,
    );
    this.name = "CourtListenerRateLimited";
    this.retryAfterMs = retryAfterMs;
  }
}

/** The caller's deadline arrived before (or while) a request could finish. */
export class CourtListenerDeadlineReached extends Error {
  constructor() {
    super("CourtListener request stopped: job deadline reached");
    this.name = "CourtListenerDeadlineReached";
  }
}

export type CourtListenerRequestPolicy = {
  /** Epoch ms. No request starts, waits, or retries past this point. */
  deadlineMs?: number;
  /** Throw CourtListenerRateLimited on the first 429 instead of retrying. */
  stopOnRateLimit?: boolean;
};

let requestPolicy: CourtListenerRequestPolicy = {};

/**
 * Process-wide request policy for budgeted jobs. Default (unset) keeps the old
 * behavior: retry 429/5xx up to four times with Retry-After capped at 60s.
 */
export function setCourtListenerRequestPolicy(policy: CourtListenerRequestPolicy): void {
  requestPolicy = { ...policy };
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Null when absent or invalid. */
export function parseRetryAfterMs(retryAfter: string | null, now = Date.now()): number | null {
  if (retryAfter === null || retryAfter.trim() === "") return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1_000 : null;
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function remainingMs(): number {
  return requestPolicy.deadlineMs === undefined ? Number.POSITIVE_INFINITY : requestPolicy.deadlineMs - Date.now();
}

/** Sleep for delayMs unless that would cross the deadline. */
async function waitWithinDeadline(delayMs: number, onPastDeadline: () => Error): Promise<void> {
  if (delayMs >= remainingMs()) throw onPastDeadline();
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface RetrievedRecord<T> {
  record: T;
  sourceUri: string;
  retrievedAt: string;
  contentHash: string;
  rawBody: string;
  responseMetadata: {
    etag?: string;
    lastModified?: string;
  };
}

export type CourtListenerOpinionOrder = "newest" | "cited";

export function courtListenerOpinionOrderBy(order: CourtListenerOpinionOrder): string {
  return order === "cited" ? "-citation_count,-date_filed" : "-date_filed";
}

export function courtListenerRetryDelayMs(retryAfter: string | null, attempt: number): number {
  const retryAfterSeconds = Number(retryAfter);
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(retryAfterSeconds * 1_000, 60_000)
    : 1_000 * (2 ** (attempt - 1));
}

function headers(useConfiguredApiToken: boolean): HeadersInit {
  const config = env();
  return {
    Accept: "application/json",
    "User-Agent": config.INGESTION_USER_AGENT,
    ...(useConfiguredApiToken && config.COURTLISTENER_API_TOKEN
      ? { Authorization: `Token ${config.COURTLISTENER_API_TOKEN}` }
      : {}),
  };
}

async function retrieve(
  url: URL,
  init: RequestInit = {},
  validators?: HttpValidators | null,
): Promise<{ response: Response; body: string }> {
  const maximumAttempts = 4;
  // CourtListener's bulk docket/opinion-cluster queries can be slow; a 30s abort
  // was tripping on legitimately-heavy pages and crashing the lane. Allow a longer
  // per-request budget (env-overridable) and treat a timeout as retryable below.
  const timeoutMs = Number.parseInt(process.env.COURTLISTENER_TIMEOUT_MS ?? "60000", 10);
  // Token fallback is scoped to THIS request. A single transient 401 must not
  // permanently downgrade the whole worker to unauthenticated access, which
  // would silently throttle every later request until a restart. Each new
  // request starts with the configured token, so a newly set or rotated token
  // takes effect immediately without a restart.
  let useConfiguredApiToken = Boolean(env().COURTLISTENER_API_TOKEN);
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const sentConfiguredToken = useConfiguredApiToken;
    // Budgeted jobs: never start a request after the deadline, and never let one
    // run past it (the scheduler SIGTERMs the job at its budget).
    const left = remainingMs();
    if (left <= 0) throw new CourtListenerDeadlineReached();
    const attemptTimeoutMs = Math.max(1_000, Math.min(timeoutMs, left));
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...headers(useConfiguredApiToken),
          ...conditionalRequestHeaders(validators),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
    } catch (error) {
      // A fetch-level rejection (request timeout via AbortSignal, or a DNS/socket
      // error) is transient. Retry with backoff instead of failing the lane; only
      // surface it after exhausting attempts, with the shared "CourtListener request
      // failed:" prefix so callers can degrade gracefully rather than crash-loop.
      if (remainingMs() <= 0) throw new CourtListenerDeadlineReached();
      if (attempt === maximumAttempts) {
        throw new Error(
          `CourtListener request failed: network ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await waitWithinDeadline(courtListenerRetryDelayMs(null, attempt), () => new CourtListenerDeadlineReached());
      continue;
    }
    if (response.status === 304) {
      throw new CourtListenerNotModified(
        url.toString(),
        response.headers.get("etag") ?? validators?.etag,
        response.headers.get("last-modified") ?? validators?.lastModified,
      );
    }
    if (response.ok) return { response, body: await response.text() };
    if (response.status === 401 && sentConfiguredToken) {
      useConfiguredApiToken = false;
      process.stderr.write(
        "CourtListener rejected the configured API token; retrying this request unauthenticated.\n",
      );
      continue;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = parseRetryAfterMs(retryAfter);
      // A budgeted job stops the run on a 429 rather than sleeping out the budget.
      if (requestPolicy.stopOnRateLimit) throw new CourtListenerRateLimited(retryAfterMs);
      // Honor the full Retry-After when it fits the deadline; otherwise stop.
      if (retryAfterMs !== null && retryAfterMs >= remainingMs()) throw new CourtListenerRateLimited(retryAfterMs);
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maximumAttempts) {
      throw new Error(`CourtListener request failed: ${response.status} ${response.statusText}`);
    }

    const delayMs = courtListenerRetryDelayMs(response.headers.get("retry-after"), attempt);
    await waitWithinDeadline(delayMs, () =>
      response.status === 429
        ? new CourtListenerRateLimited(parseRetryAfterMs(response.headers.get("retry-after")))
        : new CourtListenerDeadlineReached(),
    );
  }
  throw new Error("CourtListener request retry loop exited unexpectedly");
}

function wrap<T>(record: T, sourceUri: string, body: string, response: Response): RetrievedRecord<T> {
  return {
    record,
    sourceUri,
    retrievedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(body).digest("hex"),
    rawBody: body,
    responseMetadata: {
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    },
  };
}

export async function fetchDocket(
  id: number,
  validators?: HttpValidators | null,
): Promise<RetrievedRecord<CourtListenerDocket>> {
  const url = new URL(`dockets/${id}/`, `${env().COURTLISTENER_API_BASE_URL}/`);
  const { response, body } = await retrieve(url, {}, validators);
  return wrap(courtListenerDocketSchema.parse(JSON.parse(body)), url.toString(), body, response);
}

export async function fetchOpinionCluster(
  id: number,
): Promise<RetrievedRecord<CourtListenerOpinionCluster>> {
  const url = new URL(`clusters/${id}/`, `${env().COURTLISTENER_API_BASE_URL}/`);
  const { response, body } = await retrieve(url);
  return wrap(
    courtListenerOpinionClusterSchema.parse(JSON.parse(body)),
    url.toString(),
    body,
    response,
  );
}

export async function fetchOpinion(id: number): Promise<RetrievedRecord<CourtListenerOpinion>> {
  const url = new URL(`opinions/${id}/`, `${env().COURTLISTENER_API_BASE_URL}/`);
  const { response, body } = await retrieve(url);
  return wrap(courtListenerOpinionSchema.parse(JSON.parse(body)), url.toString(), body, response);
}

export async function fetchOpinionClusterIds(input: {
  courtCode: string;
  filedAfter: string;
  limit: number;
  order: CourtListenerOpinionOrder;
}): Promise<number[]> {
  const ids: number[] = [];
  let next: string | null = null;

  while (ids.length < input.limit) {
    const url = next
      ? new URL(next)
      : new URL("clusters/", `${env().COURTLISTENER_API_BASE_URL}/`);
    if (!next) {
      url.searchParams.set("docket__court", input.courtCode);
      url.searchParams.set("date_filed__gte", input.filedAfter);
      url.searchParams.set("order_by", courtListenerOpinionOrderBy(input.order));
    }
    const { body } = await retrieve(url);
    const page = courtListenerOpinionClusterPageSchema.parse(JSON.parse(body));
    ids.push(...page.results.map((cluster) => cluster.id));
    next = page.next;
    if (!next) break;
  }

  return ids.slice(0, input.limit);
}

export async function fetchOpinionClusterPage(input: {
  courtCode: string;
  filedAfter: string;
  filedBefore: string;
  cursor?: string;
}): Promise<{
  clusterIds: number[];
  next: string | null;
  total: number | null;
}> {
  const url = input.cursor
    ? new URL(input.cursor)
    : new URL("clusters/", `${env().COURTLISTENER_API_BASE_URL}/`);
  if (!input.cursor) {
    url.searchParams.set("docket__court", input.courtCode);
    url.searchParams.set("date_filed__gte", input.filedAfter);
    url.searchParams.set("date_filed__lt", input.filedBefore);
    url.searchParams.set("order_by", "-date_filed,-id");
  }
  const { body } = await retrieve(url);
  const page = courtListenerOpinionClusterPageSchema.parse(JSON.parse(body));
  return {
    clusterIds: page.results.map((cluster) => cluster.id),
    next: page.next,
    total: page.count ?? null,
  };
}

export async function fetchDocketPage(input: ({
  modifiedAfter: string;
  modifiedBefore: string;
  filedAfter?: never;
  filedBefore?: never;
} | {
  filedAfter: string;
  filedBefore: string;
  modifiedAfter?: never;
  modifiedBefore?: never;
}) & { cursor?: string }): Promise<{
  records: RetrievedRecord<CourtListenerDocket>[];
  next: string | null;
  total: number | null;
}> {
  const url = input.cursor
    ? new URL(input.cursor)
    : new URL("dockets/", `${env().COURTLISTENER_API_BASE_URL}/`);
  if (!input.cursor) {
    if (input.filedAfter !== undefined && input.filedBefore !== undefined) {
      url.searchParams.set("date_filed__gte", input.filedAfter);
      url.searchParams.set("date_filed__lt", input.filedBefore);
      url.searchParams.set("order_by", "date_filed,id");
    } else {
      url.searchParams.set("date_modified__gte", input.modifiedAfter);
      url.searchParams.set("date_modified__lt", input.modifiedBefore);
      url.searchParams.set("order_by", "date_modified,id");
    }
  }
  const { response, body } = await retrieve(url);
  const page = courtListenerPageSchema.parse(JSON.parse(body));
  return {
    records: page.results.map((record) =>
      wrap(record, record.resource_uri, JSON.stringify(record), response),
    ),
    next: page.next,
    total: page.count ?? null,
  };
}

export async function fetchModifiedDockets(
  modifiedAfter: string,
  cursor?: string,
): Promise<{ records: RetrievedRecord<CourtListenerDocket>[]; next: string | null }> {
  const url = cursor
    ? new URL(cursor)
    : new URL("dockets/", `${env().COURTLISTENER_API_BASE_URL}/`);
  if (!cursor) {
    url.searchParams.set("date_modified__gte", modifiedAfter);
    url.searchParams.set("order_by", "date_modified");
  }

  const { response, body } = await retrieve(url);
  const page = courtListenerPageSchema.parse(JSON.parse(body));
  return {
    records: page.results.map((record) =>
      wrap(record, record.resource_uri, JSON.stringify(record), response),
    ),
    next: page.next,
  };
}

export async function fetchDocketParties(
  docketId: number,
  maximumPages = 100,
): Promise<RetrievedRecord<CourtListenerParty>[]> {
  const records: RetrievedRecord<CourtListenerParty>[] = [];
  let next: string | null = null;

  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const url = next
      ? new URL(next)
      : new URL("parties/", `${env().COURTLISTENER_API_BASE_URL}/`);

    if (!next) {
      url.searchParams.set("docket", String(docketId));
      url.searchParams.set("filter_nested_results", "true");
    }

    const { response, body } = await retrieve(url);
    const page = courtListenerPartyPageSchema.parse(JSON.parse(body));
    records.push(
      ...page.results.map((record) =>
        wrap(record, record.resource_uri, JSON.stringify(record), response),
      ),
    );

    next = page.next;
    if (!next) return records;
  }

  throw new Error(`CourtListener party pagination exceeded ${maximumPages} pages`);
}

export async function fetchDocketEntries(
  docketId: number,
  maximumPages = 500,
  orderBy: "date_filed,id" | "-date_filed,-id" = "date_filed,id",
): Promise<RetrievedRecord<CourtListenerDocketEntry>[]> {
  const records: RetrievedRecord<CourtListenerDocketEntry>[] = [];
  let next: string | null = null;

  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const url = next
      ? new URL(next)
      : new URL("docket-entries/", `${env().COURTLISTENER_API_BASE_URL}/`);

    if (!next) {
      url.searchParams.set("docket", String(docketId));
      url.searchParams.set("order_by", orderBy);
    }

    const { response, body } = await retrieve(url);
    const page = courtListenerDocketEntryPageSchema.parse(JSON.parse(body));
    records.push(
      ...page.results.map((record) =>
        wrap(record, record.resource_uri, JSON.stringify(record), response),
      ),
    );

    next = page.next;
    if (!next) return records;
  }

  throw new Error(`CourtListener docket-entry pagination exceeded ${maximumPages} pages`);
}


// Exact lookup. Retain the response as source evidence; ambiguous results are
// never silently reduced to the first cluster.
export async function fetchCitationLookup(citation: string): Promise<RetrievedRecord<Array<{
  status: number; clusters: Array<{id: number; citations: unknown[]}>;
}>>> {
  const url = new URL("citation-lookup/", `${env().COURTLISTENER_API_BASE_URL}/`);
  const {response, body} = await retrieve(url, {method: "POST", body: new URLSearchParams({text: citation})});
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error("Malformed citation lookup response");
  const record = parsed.map(value => {
    if (!value || typeof value !== "object" || typeof value.status !== "number" || !Array.isArray(value.clusters)) throw new Error("Malformed citation lookup result");
    const clusters = value.clusters.map((cluster: unknown) => {
      if (!cluster || typeof cluster !== "object") throw new Error("Malformed citation cluster");
      const object=cluster as Record<string, unknown>;
      if (!Number.isSafeInteger(object.id) || Number(object.id)<=0 || !Array.isArray(object.citations)) throw new Error("Malformed citation cluster identity");
      return {id:Number(object.id), citations:object.citations};
    });
    return {status:value.status, clusters};
  });
  return wrap(record,url.toString(),body,response);
}
