import { createHash } from "node:crypto";

const OFFICIAL_ORIGIN = "https://www.supremecourt.gov";
const INDEX_URL = `${OFFICIAL_ORIGIN}/opinions/USReports.aspx`;
const MAX_INDEX_BYTES = 3 * 1024 * 1024;
const MAX_VOLUME_BYTES = 350 * 1024 * 1024;

export interface OfficialBoundVolume {
  volume: number;
  termYear: string;
  pdfUrl: string;
}

export interface OfficialBoundOpinion {
  sourceRecordId: string;
  releaseNumber: null;
  filedOn: string;
  docketNumber: string;
  caseName: string;
  authorCode: null;
  citation: string;
  pdfUrl: string;
  startPage: number;
  endPage: number | null;
}

function decodeHtml(value: string) {
  return value.replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ").trim();
}

function officialPdfUrl(href: string, base = INDEX_URL) {
  const url = new URL(href, base);
  if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("Bound-volume link is not an official Supreme Court PDF");
  }
  return url.toString();
}

function isoLongDate(value: string) {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i.exec(value.trim());
  if (!match) throw new Error(`Unsupported bound-volume decision date: ${value}`);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf((match[1] ?? "").toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2]?.padStart(2, "0")}`;
}

export function parseOfficialBoundVolumeIndex(html: string) {
  const volumes: OfficialBoundVolume[] = [];
  for (const match of html.matchAll(/<a\b[^>]*id\s*=\s*["'](\d+)["'][^>]*href\s*=\s*["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const volume = Number.parseInt(match[1] ?? "", 10);
    const label = decodeHtml(match[3] ?? "");
    const term = /\((\d{4})(?:,\s*\d{4})?\s+Term\b/i.exec(label)?.[1];
    if (!Number.isInteger(volume) || !term) continue;
    volumes.push({ volume, termYear: term.slice(-2), pdfUrl: officialPdfUrl(match[2] ?? "") });
  }
  return [...new Map(volumes.map((item) => [item.volume, item])).values()].sort((a, b) => b.volume - a.volume);
}

function captionIndex(text: string, ordersStart: number) {
  const captions = new Map<number, string>();
  for (const line of text.split(/[\n\f]/)) {
    const match = /^\s*(.+?\bv\.\s+.+?)\s+(?:\.\s*){2,}(\d{1,4})(?:,\s*\d{1,4})*\s*$/.exec(line);
    if (!match) continue;
    const page = Number.parseInt(match[2] ?? "", 10);
    const caption = (match[1] ?? "").replaceAll(/\s+/g, " ").trim();
    const existing = captions.get(page);
    const crossReference = (value: string) => value.includes(";") || /v\.\s*\.$/.test(value);
    if (page < ordersStart && (!existing || (crossReference(existing) && !crossReference(caption)))) captions.set(page, caption);
  }
  return captions;
}

function opinionPageCaption(page: string) {
  const normalized = page.replaceAll(/\s+/g, " ").trim();
  const heading = normalized.replace(/^.*?\b(?:Syllabus|Judgment)\s+(?=[A-Z])/i, "");
  const match = /([A-Z][A-Z0-9 .,'’&()-]+?\bv\.\s+[A-Z][A-Z0-9 .,'’&()-]+?)\s+(?:certiorari|appeal|on\s+(?:petition|exceptions|writ|bill))/i.exec(heading);
  if (!match) return null;
  return (match[1] ?? "")
    .replaceAll(/\s+et al\.?/gi, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bV\./, "v.");
}

function reportPage(page: string, volume: number) {
  const citation = new RegExp(`Cite as:\\s*${volume}\\s+U\\.\\s*S\\.\\s*(\\d+)`, "i").exec(page)?.[1];
  if (citation) return Number.parseInt(citation, 10);
  const termHeader = /^\s*OCTOBER TERM,\s+\d{4}\s+(\d{1,4})\s*$/m.exec(page)?.[1];
  if (termHeader) return Number.parseInt(termHeader, 10);
  const standalone = [...page.matchAll(/^\s*(\d{1,4})\s*$/gm)].at(-1)?.[1];
  return standalone ? Number.parseInt(standalone, 10) : null;
}

export function parseOfficialBoundVolumeText(text: string, source: OfficialBoundVolume) {
  const pages = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\f");
  const ordersStart = Number.parseInt(/Cases reported on page\s+(\d{1,4})\s+et seq\./i.exec(text)?.[1] ?? "1001", 10);
  const captions = captionIndex(text, ordersStart);
  const starts: Array<Omit<OfficialBoundOpinion, "endPage">> = [];
  for (const [index, page] of pages.entries()) {
    const docketMatch = /\bNos?\.\s+([^\n.]+?)\./m.exec(page);
    const decisionMatch = /\bDecided\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/m.exec(page);
    const enteredMatch = /\b(?:Order and judgment|Judgment|Order) entered\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/m.exec(page);
    if (!docketMatch || !decisionMatch) continue;
    const firstPage = reportPage(page, source.volume);
    if (firstPage === null || firstPage >= ordersStart) continue;
    const indexedCaseName = captions.get(firstPage);
    const indexArtifact = indexedCaseName?.includes(";") || /v\.\s*\.$/.test(indexedCaseName ?? "");
    const caseName = indexArtifact ? opinionPageCaption(page) : indexedCaseName;
    if (!caseName) continue;
    const docketNumber = (docketMatch[1] ?? "").replaceAll(/[–—]/g, "-").replaceAll(/\s+/g, " ").trim();
    const startPage = index + 1;
    starts.push({
      sourceRecordId: `bound:${source.volume}:${firstPage}:${docketNumber}`,
      releaseNumber: null,
      filedOn: isoLongDate(enteredMatch?.[1] ?? decisionMatch[1] ?? ""),
      docketNumber,
      caseName,
      authorCode: null,
      citation: `${source.volume} U.S. ${firstPage}`,
      pdfUrl: `${source.pdfUrl}#page=${startPage}`,
      startPage,
    });
  }
  const unique = [...new Map(starts.map((record) => [record.sourceRecordId, record])).values()]
    .sort((a, b) => a.startPage - b.startPage);
  const firstOpinionPage = unique[0]?.startPage ?? Number.POSITIVE_INFINITY;
  const firstOrdersPage = pages.findIndex((page, index) => index + 1 > firstOpinionPage
    && /\\bORDERS\\b/i.test(page)
    && (reportPage(page, source.volume) ?? 0) >= ordersStart) + 1;
  const finalMeritsPage = firstOrdersPage > 0 ? firstOrdersPage - 1 : null;
  return unique.map((record, index): OfficialBoundOpinion => ({
    ...record,
    endPage: unique[index + 1] ? (unique[index + 1]?.startPage ?? record.startPage) - 1 : finalMeritsPage,
  }));
}

async function boundedBody(response: Response, maximum: number) {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maximum) throw new Error(`Official source exceeds ${maximum} byte cap`);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximum) throw new Error(`Official source exceeds ${maximum} byte cap`);
  return body;
}

export async function fetchOfficialBoundVolumeIndex() {
  const response = await fetch(INDEX_URL, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court U.S. Reports index returned HTTP ${response.status}`);
  const body = await boundedBody(response, MAX_INDEX_BYTES);
  const rawBody = new TextDecoder().decode(body);
  return { sourceUri: INDEX_URL, rawBody, contentHash: createHash("sha256").update(body).digest("hex"),
    retrievedAt: new Date().toISOString(), volumes: parseOfficialBoundVolumeIndex(rawBody) };
}

export async function fetchOfficialBoundVolume(source: OfficialBoundVolume) {
  const url = officialPdfUrl(source.pdfUrl);
  const response = await fetch(url, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court bound volume returned HTTP ${response.status}`);
  const body = await boundedBody(response, MAX_VOLUME_BYTES);
  if (body[0] !== 0x25 || body[1] !== 0x50 || body[2] !== 0x44 || body[3] !== 0x46) throw new Error("Official bound-volume response is not a PDF");
  return { sourceUri: url, body, contentHash: createHash("sha256").update(body).digest("hex"),
    retrievedAt: new Date().toISOString(), mediaType: "application/pdf" };
}
