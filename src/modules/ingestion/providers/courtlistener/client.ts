import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
import {
  courtListenerDocketSchema,
  courtListenerDocketEntryPageSchema,
  courtListenerPageSchema,
  courtListenerPartyPageSchema,
  type CourtListenerDocket,
  type CourtListenerDocketEntry,
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

function headers(): HeadersInit {
  const config = env();
  return {
    Accept: "application/json",
    "User-Agent": config.INGESTION_USER_AGENT,
    ...(config.COURTLISTENER_API_TOKEN
      ? { Authorization: `Token ${config.COURTLISTENER_API_TOKEN}` }
      : {}),
  };
}

let requestGate: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRequestSlot() {
  const minimumInterval = env().COURTLISTENER_MIN_REQUEST_INTERVAL_MS;
  const waitFor = Math.max(0, lastRequestStartedAt + minimumInterval - Date.now());
  if (waitFor > 0) await sleep(waitFor);
  lastRequestStartedAt = Date.now();
}

async function inRequestSlot<T>(work: () => Promise<T>): Promise<T> {
  const previous = requestGate;
  let release = () => {};
  requestGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await waitForRequestSlot();
    return await work();
  } finally {
    release();
  }
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  return Math.min(60_000, 2 ** attempt * 2_000);
}

async function retrieve(url: URL): Promise<{ response: Response; body: string }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await inRequestSlot(() =>
      fetch(url, {
        headers: headers(),
        signal: AbortSignal.timeout(30_000),
      }),
    );
    if (response.ok) return { response, body: await response.text() };

    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleep(retryDelay(response, attempt));
      continue;
    }
    throw new Error(`CourtListener request failed: ${response.status} ${response.statusText}`);
  }
  throw new Error("CourtListener request failed after retries");
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
