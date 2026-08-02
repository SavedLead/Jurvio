import { createHash } from "node:crypto";

const LOC_ORIGIN = "https://www.loc.gov";
const LOC_STORAGE_ORIGIN = "https://tile.loc.gov";
const COLLECTION_URL = `${LOC_ORIGIN}/collections/united-states-reports/`;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const LOC_FETCH_ATTEMPTS = 4;
const LOC_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface LocUsReportsRecord {
  sourceRecordId: string;
  itemUrl: string;
  caseName: string;
  citation: string;
  volume: number;
  reporterPage: number;
  decisionYear: number;
  pdfUrl: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function officialLocUrl(raw: string) {
  const url = new URL(raw, LOC_ORIGIN);
  // LOC's historic collection JSON still emits http item identifiers. Canonicalize
  // only its two official hosts before enforcing HTTPS for the actual fetch.
  if (url.protocol === "http:" && (url.hostname === "www.loc.gov" || url.hostname === "tile.loc.gov")) {
    url.protocol = "https:";
  }
  if (url.protocol !== "https:" || (url.origin !== LOC_ORIGIN && url.origin !== LOC_STORAGE_ORIGIN)) {
    throw new Error("Library of Congress resource left the official origin");
  }
  return url.toString();
}

function findPdf(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      const url = officialLocUrl(value);
      return new URL(url).pathname.toLowerCase().endsWith(".pdf") ? url : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPdf(item);
      if (found) return found;
    }
    return null;
  }
  const object = asObject(value);
  if (!object) return null;
  for (const key of ["url", "pdf", "fulltext_file", "download", "files", "resources"]) {
    const found = findPdf(object[key]);
    if (found) return found;
  }
  return null;
}

function parseTitle(title: string, expectedVolume: number) {
  const normalized = title.replaceAll(/\s+/g, " ").trim().replace(/^(?:U\.?\s*S\.?|United States)\s+Reports:\s*/i, "");
  const match = /^(.+?),\s*(\d+)\s+U\.?\s*S\.?\s*(\d+)\s*\((\d{4})\)\.?$/i.exec(normalized);
  if (!match || Number(match[2]) !== expectedVolume) return null;
  return {
    caseName: match[1]?.trim() ?? "",
    reporterPage: Number.parseInt(match[3] ?? "", 10),
    decisionYear: Number.parseInt(match[4] ?? "", 10),
  };
}

function isAncillaryVolumeMaterial(caseName: string): boolean {
  // LOC lists several bound-volume components alongside opinions. They are
  // authoritative artifacts, but not case records and therefore cannot supply
  // a case docket or decision date.
  return /^(?:reporter['’]s note(?:\s*[a-z])?|orders|index)\b/i.test(caseName.trim());
}

export function parseLocUsReportsResults(payload: unknown, expectedVolume: number): LocUsReportsRecord[] {
  if (!Number.isInteger(expectedVolume) || expectedVolume < 2 || expectedVolume > 501) {
    throw new Error("Library of Congress volume must be between 2 and 501");
  }
  const root = asObject(payload);
  const results = Array.isArray(root?.results) ? root.results : [];
  const records: LocUsReportsRecord[] = [];
  for (const raw of results) {
    const item = asObject(raw);
    if (!item) continue;
    const title = strings(item.title)[0];
    const id = strings(item.id)[0] ?? strings(item.url)[0];
    const parsed = title ? parseTitle(title, expectedVolume) : null;
    const pdfUrl = findPdf(item);
    if (!parsed || !id || !pdfUrl || !parsed.caseName || !Number.isInteger(parsed.reporterPage)
      || isAncillaryVolumeMaterial(parsed.caseName)) continue;
    const itemUrl = officialLocUrl(id);
    const sourceId = new URL(itemUrl).pathname.split("/").filter(Boolean).at(-1);
    if (!sourceId) continue;
    records.push({
      sourceRecordId: `loc:${sourceId}`,
      itemUrl,
      caseName: parsed.caseName,
      citation: `${expectedVolume} U.S. ${parsed.reporterPage}`,
      volume: expectedVolume,
      reporterPage: parsed.reporterPage,
      decisionYear: parsed.decisionYear,
      pdfUrl,
    });
  }
  return [...new Map(records.map((record) => [record.sourceRecordId, record])).values()]
    .sort((a, b) => a.reporterPage - b.reporterPage);
}

function retryAfterMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  return Math.min(1_000 * 2 ** (attempt - 1), 8_000) + Math.floor(Math.random() * 250);
}

async function fetchOfficialLoc(url: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LOC_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" },
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok || !LOC_RETRYABLE_STATUS.has(response.status) || attempt === LOC_FETCH_ATTEMPTS) {
        return response;
      }
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === LOC_FETCH_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * 2 ** (attempt - 1), 8_000)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Library of Congress request failed");
}

async function boundedBody(response: Response, maximum: number) {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maximum) throw new Error(`Library of Congress response exceeds ${maximum} byte cap`);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximum) throw new Error(`Library of Congress response exceeds ${maximum} byte cap`);
  return body;
}

export async function fetchLocUsReportsVolume(volume: number) {
  if (!Number.isInteger(volume) || volume < 2 || volume > 501) throw new Error("Unsupported Library of Congress volume");
  // LOC's full-text index is inconsistent across historical volumes. Try its
  // citation spellings first, then a numeric collection search; every result is
  // still validated against the exact U.S. Reports volume before ingestion.
  const attempts: Array<{ query: string; url: string; rawBody: string; body: Uint8Array; records: LocUsReportsRecord[] }> = [];
  for (const query of [`${volume} US`, `${volume} U.S.`, String(volume)]) {
    const url = new URL(COLLECTION_URL);
    url.searchParams.set("fo", "json");
    url.searchParams.set("at", "results,pagination");
    url.searchParams.set("c", "150");
    url.searchParams.set("q", query);
    const response = await fetchOfficialLoc(url.toString());
    if (!response.ok) throw new Error(`Library of Congress volume index returned HTTP ${response.status}`);
    const body = await boundedBody(response, MAX_JSON_BYTES);
    const rawBody = new TextDecoder().decode(body);
    const records = parseLocUsReportsResults(JSON.parse(rawBody), volume);
    attempts.push({ query, url: url.toString(), rawBody, body, records });
    if (records.length > 0) {
      return {
        sourceUri: url.toString(),
        rawBody,
        contentHash: createHash("sha256").update(body).digest("hex"),
        retrievedAt: new Date().toISOString(),
        records,
      };
    }
  }
  const diagnostics = attempts.map((attempt) => `${JSON.stringify(attempt.query)}=${attempt.records.length}`).join(", ");
  throw new Error(`Library of Congress returned no matching cases for Volume ${volume}; official queries tried: ${diagnostics}`);
}

export async function fetchLocUsReportsPdf(rawUrl: string) {
  const url = officialLocUrl(rawUrl);
  if (!new URL(url).pathname.toLowerCase().endsWith(".pdf")) throw new Error("Library of Congress resource is not a PDF");
  const response = await fetchOfficialLoc(url.toString());
  if (!response.ok) throw new Error(`Library of Congress PDF returned HTTP ${response.status}`);
  const body = await boundedBody(response, MAX_PDF_BYTES);
  if (body[0] !== 0x25 || body[1] !== 0x50 || body[2] !== 0x44 || body[3] !== 0x46) {
    throw new Error("Library of Congress response is not a PDF");
  }
  return {
    sourceUri: url,
    body,
    mediaType: "application/pdf",
    contentHash: createHash("sha256").update(body).digest("hex"),
    retrievedAt: new Date().toISOString(),
  };
}