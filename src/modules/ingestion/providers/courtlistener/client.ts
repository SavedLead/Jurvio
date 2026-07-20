import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
import { courtListenerDocketSchema, courtListenerPageSchema, type CourtListenerDocket } from "./schema";

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

async function retrieve(url: URL): Promise<{ response: Response; body: string }> {
  const response = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`CourtListener request failed: ${response.status} ${response.statusText}`);
  }
  return { response, body: await response.text() };
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
    records: page.results.map((record) => wrap(record, url.toString(), JSON.stringify(record), response)),
    next: page.next,
  };
}
