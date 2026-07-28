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

function captionIndex(text: string) {
  const captions = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*(.+?\bv\.\s+.+?)\s+(?:\.\s*){2,}(\d{1,4})\s*$/.exec(line);
    if (!match) continue;
    const page = Number.parseInt(match[2] ?? "", 10);
    const caption = (match[1] ?? "").replaceAll(/\s+/g, " ").trim();
    if (page < 1001 && !captions.has(page)) captions.set(page, caption);
  }
  return captions;
}

function reportPage(page: string, volume: number) {
  const citation = new RegExp(`Cite as:\\s*${volume}\\s+U\\.\\s*S\\.\\s*(\\d+)`, "i").exec(page)?.[1];
  if (citation) return Number.parseInt(citation, 10);
  const standalone = [...page.matchAll(/^\s*(\d{1,4})\s*$/gm)].at(-1)?.[1];
  return standalone ? Number.parseInt(standalone, 10) : null;
}

export function parseOfficialBoundVolumeText(text: string, source: OfficialBoundVolume) {
  const pages = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\f");
  const captions = captionIndex(text);
  const starts: Array<Omit<OfficialBoundOpinion, "endPage">> = [];
  for (const [index, page] of pages.entries()) {
    const docketAndDate = /\bNos?\.\s+([^\n.]+?)\.\s+(?:Argued[^\n]*?[—-]\s*)?Decided\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/m.exec(page);
    if (!docketAndDate) continue;
    const firstPage = reportPage(page, source.volume);
    if (firstPage === null || firstPage >= 1001) continue;
    const caseName = captions.get(firstPage);
    if (!caseName) continue;
    const docketNumber = (docketMatch[1] ?? "").replaceAll(/[–—]/g, "-").replaceAll(/\s+/g, " ").trim();
    const startPage = index + 1;
    starts.push({
      sourceRecordId: `bound:${source.volume}:${firstPage}:${docketNumber}`,
      releaseNumber: null,
      filedOn: isoLongDate(decisionMatch[1] ?? ""),
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
  return unique.map((record, index): OfficialBoundOpinion => ({
    ...record,
    endPage: unique[index + 1] ? (unique[index + 1]?.startPage ?? record.startPage) - 1 : null,
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
