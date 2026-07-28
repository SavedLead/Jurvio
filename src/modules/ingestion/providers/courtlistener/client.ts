import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
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

let useConfiguredApiToken = true;

function headers(): HeadersInit {
  const config = env();
  return {
    Accept: "application/json",
    "User-Agent": config.INGESTION_USER_AGENT,
    ...(useConfiguredApiToken && config.COURTLISTENER_API_TOKEN
      ? { Authorization: `Token ${config.COURTLISTENER_API_TOKEN}` }
      : {}),
  };
}

async function retrieve(url: URL): Promise<{ response: Response; body: string }> {
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const sentConfiguredToken = Boolean(
      useConfiguredApiToken && env().COURTLISTENER_API_TOKEN,
    );
    const response = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return { response, body: await response.text() };
    if (response.status === 401 && sentConfiguredToken) {
      useConfiguredApiToken = false;
      process.stderr.write(
        "CourtListener rejected the configured API token; retrying public access.\n",
      );
      continue;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maximumAttempts) {
      throw new Error(`CourtListener request failed: ${response.status} ${response.statusText}`);
    }

    const delayMs = courtListenerRetryDelayMs(response.headers.get("retry-after"), attempt);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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

export async function fetchDocket(id: number): Promise<RetrievedRecord<CourtListenerDocket>> {
  const url = new URL(`dockets/${id}/`, `${env().COURTLISTENER_API_BASE_URL}/`);
  const { response, body } = await retrieve(url);
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
): Promise<RetrievedRecord<CourtListenerDocketEntry>[]> {
  const records: RetrievedRecord<CourtListenerDocketEntry>[] = [];
  let next: string | null = null;

  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const url = next
      ? new URL(next)
      : new URL("docket-entries/", `${env().COURTLISTENER_API_BASE_URL}/`);

    if (!next) {
      url.searchParams.set("docket", String(docketId));
      url.searchParams.set("order_by", "date_filed,id");
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
