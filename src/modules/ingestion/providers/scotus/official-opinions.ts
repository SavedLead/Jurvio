import { createHash } from "node:crypto";

const OFFICIAL_ORIGIN = "https://www.supremecourt.gov";
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 40 * 1024 * 1024;

export interface OfficialSlipOpinion {
  sourceRecordId: string;
  releaseNumber: string | null;
  filedOn: string;
  docketNumber: string;
  caseName: string;
  authorCode: string | null;
  citation: string | null;
  pdfUrl: string;
}

export interface RetrievedOfficialIndex {
  sourceUri: string;
  rawBody: string;
  contentHash: string;
  retrievedAt: string;
  records: OfficialSlipOpinion[];
}

export interface RetrievedOfficialPdf {
  sourceUri: string;
  body: Uint8Array;
  contentHash: string;
  retrievedAt: string;
  mediaType: string;
}

function decodeHtml(value: string) {
  return value.replaceAll(/<br\s*\/?>/gi, " ").replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"').replaceAll(/\s+/g, " ").trim();
}

function officialUrl(href: string, base: string) {
  const url = new URL(href.replaceAll("&amp;", "&"), base);
  if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("Slip-opinion link is not an official Supreme Court PDF");
  }
  return url.toString();
}

function isoDate(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) throw new Error(`Unsupported Supreme Court opinion date: ${value}`);
  const year = match[3]?.length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[1]?.padStart(2, "0")}-${match[2]?.padStart(2, "0")}`;
}

export function parseOfficialSlipOpinionIndex(html: string, termYear: string, sourceUri: string) {
  if (!/^\d{2}$/.test(termYear)) throw new Error("Supreme Court term must be a two-digit year");
  const records: OfficialSlipOpinion[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = row[1] ?? "";
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? "");
    if (cells.length < 5) continue;
    const link = /href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/i.exec(rowHtml)?.[1];
    if (!link) continue;
    const values = cells.map(decodeHtml);
    const releaseNumber = values[0] || null;
    const filedOn = isoDate(values[1] ?? "");
    const docketNumber = values[2]?.trim() ?? "";
    const caseName = values[3]?.trim() ?? "";
    if (!docketNumber || !caseName) throw new Error("Official opinion row lacks a docket number or case name");
    const pdfUrl = officialUrl(link, sourceUri);
    const pdfName = new URL(pdfUrl).pathname.split("/").pop() ?? "opinion.pdf";
    records.push({
      sourceRecordId: `${termYear}:${docketNumber}:${pdfName}`,
      releaseNumber, filedOn, docketNumber, caseName,
      authorCode: values[4] || null, citation: values[5] || null, pdfUrl,
    });
  }
  const unique = new Map(records.map((record) => [record.sourceRecordId, record]));
  return [...unique.values()].sort((a, b) => a.filedOn.localeCompare(b.filedOn) || a.sourceRecordId.localeCompare(b.sourceRecordId));
}

async function boundedBody(response: Response, maxBytes: number) {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new Error(`Official source exceeds ${maxBytes} byte cap`);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxBytes) throw new Error(`Official source exceeds ${maxBytes} byte cap`);
  return body;
}

export async function fetchOfficialSlipOpinionIndex(termYear: string): Promise<RetrievedOfficialIndex> {
  if (!/^\d{2}$/.test(termYear)) throw new Error("Supreme Court term must be a two-digit year");
  const sourceUri = `${OFFICIAL_ORIGIN}/opinions/slipopinion/${termYear}`;
  const response = await fetch(sourceUri, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court index returned HTTP ${response.status}`);
  const bytes = await boundedBody(response, MAX_INDEX_BYTES);
  const rawBody = new TextDecoder().decode(bytes);
  return { sourceUri, rawBody, contentHash: createHash("sha256").update(bytes).digest("hex"),
    retrievedAt: new Date().toISOString(), records: parseOfficialSlipOpinionIndex(rawBody, termYear, sourceUri) };
}

export async function fetchOfficialOpinionPdf(sourceUri: string): Promise<RetrievedOfficialPdf> {
  const validated = officialUrl(sourceUri, OFFICIAL_ORIGIN);
  const response = await fetch(validated, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court PDF returned HTTP ${response.status}`);
  const body = await boundedBody(response, MAX_PDF_BYTES);
  if (body[0] !== 0x25 || body[1] !== 0x50 || body[2] !== 0x44 || body[3] !== 0x46) throw new Error("Official opinion response is not a PDF");
  return { sourceUri: validated, body, contentHash: createHash("sha256").update(body).digest("hex"),
    retrievedAt: new Date().toISOString(), mediaType: "application/pdf" };
}
