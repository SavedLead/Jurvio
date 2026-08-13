import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_ORIGIN = "https://www.supremecourt.gov";
const INDEX_URL = `${OFFICIAL_ORIGIN}/opinions/USReports.aspx`;
const MAX_INDEX_BYTES = 3 * 1024 * 1024;
const MAX_VOLUME_BYTES = 350 * 1024 * 1024;
const MIRROR_DIR = process.env.SCOTUS_BOUND_MIRROR_DIR;

export interface OfficialBoundVolume {
  volume: number;
  termYear: string;
  pdfUrl: string;
}

export function officialBoundVolumeMirrorFileName(volume: number) {
  if (!Number.isInteger(volume) || volume < 1) throw new Error(`Invalid official bound volume: ${volume}`);
  return `${volume}BV.pdf`;
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
    && /\bORDERS\b/i.test(page)
    && (reportPage(page, source.volume) ?? 0) >= ordersStart) + 1;
  const finalMeritsPage = firstOrdersPage > 0 ? firstOrdersPage - 1 : null;
  return unique.map((record, index): OfficialBoundOpinion => ({
    ...record,
    endPage: unique[index + 1] ? (unique[index + 1]?.startPage ?? record.startPage) - 1 : finalMeritsPage,
  }));
}

// --- Nominative-reporter era (volumes 1-90, ~1790-1874) -------------------
// These pre-91 volumes predate docket numbers and per-page "Decided" lines, so
// parseOfficialBoundVolumeText (which requires both) yields nothing for them.
// The Library of Congress per-case catalog also floors at volume 91, so both the
// case list and the decision text must come straight from the whole-volume
// PDF/A. Identity is taken from the front-matter "Table of Cases Reported"
// (authoritative case name + star/report page); the first page of each case is
// located from the running-header page numbers, which occupy the same page-number
// space as the Table of Cases (verified: header "185 SUPREME COURT / Taylor v.
// Taylor" <-> table "Taylor v. Taylor et al. ... 183").

const NOMINATIVE_MONTHS = "JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER";

export function parseNominativeTermYear(text: string): number | null {
  const match = new RegExp(`(?:${NOMINATIVE_MONTHS})\\s+TERM,?\\s+(\\d{4})`, "i").exec(text);
  const year = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  return Number.isInteger(year) && year >= 1789 && year <= 1900 ? year : null;
}

function nominativeReportPage(page: string): number | null {
  for (const raw of page.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4)) {
    const leading = /^(\d{1,4})\s+SUPREME COURT\.?/.exec(raw);
    if (leading) return Number.parseInt(leading[1] ?? "", 10);
    const trailing = /SUPREME COURT\.?\s+(\d{1,4})$/.exec(raw);
    if (trailing) return Number.parseInt(trailing[1] ?? "", 10);
  }
  return null;
}

export function parseNominativeTableOfCases(text: string, volume: number): Array<{ caseName: string; reportPage: number }> {
  const startMarker = /A?\s*TABLE OF (?:THE )?CASES REPORTED/i.exec(text);
  if (!startMarker) return [];
  // The reported-cases table ends where the cited-cases table begins.
  const afterStart = text.slice(startMarker.index + startMarker[0].length);
  const endMarker = /(?:TABLE OF (?:THE )?CASES CITED|CASES CITED IN THIS VOLUME)/i.exec(afterStart);
  const region = endMarker ? afterStart.slice(0, endMarker.index) : afterStart.slice(0, 40_000);
  const byPage = new Map<number, { name: string; reconstructed: boolean }>();
  for (const line of region.split(/[\n\f]/)) {
    const match = /^\s*([A-Z][^\n]*?)[.\s•·,]{2,}(\d{1,4})\.?\s*$/.exec(line);
    if (!match) continue;
    const reportPage = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isInteger(reportPage) || reportPage < 1 || reportPage > 4_000) continue;
    const rawName = (match[1] ?? "").replaceAll(/\s+/g, " ").trim();
    if (rawName.length < 4 || rawName.length > 140) continue;
    const forwardParty = /\bv\.\s+\S/.test(rawName);
    const reversed = /,\s.+\bv\.\s*$/.test(rawName);
    const special = /^(?:Ex parte|In re|In the Matter of|The )/i.test(rawName);
    let name: string;
    let reconstructed = false;
    if (forwardParty) {
      name = rawName;
    } else if (reversed) {
      const comma = rawName.indexOf(",");
      const head = rawName.slice(0, comma).trim();
      const tail = rawName.slice(comma + 1).replace(/\s*v\.\s*$/i, "").trim();
      if (!head || !tail) continue;
      name = `${tail} v. ${head}`;
      reconstructed = true;
    } else if (special) {
      name = rawName;
    } else {
      continue;
    }
    const existing = byPage.get(reportPage);
    // Prefer a native forward "X v. Y" entry over a reconstructed reversed one.
    if (!existing || (existing.reconstructed && !reconstructed)) byPage.set(reportPage, { name, reconstructed });
  }
  void volume;
  return [...byPage.entries()]
    .map(([reportPage, value]) => ({ caseName: value.name, reportPage }))
    .sort((a, b) => a.reportPage - b.reportPage);
}

export function parseNominativeBoundVolumeText(text: string, source: OfficialBoundVolume): OfficialBoundOpinion[] {
  const pages = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\f");
  // Skip table entries whose star page exceeds the physical page count: that report
  // page cannot exist in this volume, so the number is an OCR error (e.g. 317 read
  // as 817). Dropping it avoids emitting a wrong citation; the case is simply left
  // for a later, better OCR pass rather than published under a bad number.
  const reported = parseNominativeTableOfCases(text, source.volume)
    .filter((entry) => entry.reportPage <= pages.length);
  if (reported.length === 0) return [];
  const termYear = parseNominativeTermYear(text);
  const filedOn = `${termYear ?? Number.parseInt(`18${source.termYear}`, 10)}-01-01`;
  // Observed (pdf page -> report page) anchors from the running headers.
  const anchors: Array<{ pdf: number; report: number }> = [];
  for (const [index, page] of pages.entries()) {
    const report = nominativeReportPage(page);
    if (report !== null) anchors.push({ pdf: index + 1, report });
  }
  // Drop implausible header anchors (an OCR outlier such as a footnote number
  // misread as a page header can never exceed the physical page count by much),
  // then map a report page to a PDF page by interpolating from the header anchor
  // whose report number is CLOSEST to it. Closest-anchor interpolation is robust
  // to isolated bad anchors -- a far outlier is never the nearest to a real target
  // -- unlike a running monotonic filter, where one early false-high header would
  // drop every later real anchor and collapse a whole stretch of the volume onto a
  // few pages. Start pages are still forced strictly increasing below.
  const plausible = anchors.filter((anchor) => anchor.report <= pages.length + 50);
  if (plausible.length === 0) return [];
  const pdfForReport = (report: number): number => {
    let best = plausible[0] as { pdf: number; report: number };
    for (const anchor of plausible) {
      if (anchor.report === report) return anchor.pdf;
      if (Math.abs(anchor.report - report) < Math.abs(best.report - report)) best = anchor;
    }
    return Math.min(Math.max(best.pdf + (report - best.report), 1), pages.length);
  };
  let lastStart = 0;
  const starts = reported.map((entry) => {
    // Start pages are strictly increasing in ToC order so consecutive cases tile
    // the volume without inverted or zero-length page ranges.
    const startPage = Math.max(pdfForReport(entry.reportPage), lastStart + 1);
    lastStart = startPage;
    return {
      sourceRecordId: `nom:${source.volume}:${entry.reportPage}`,
      releaseNumber: null as null,
      filedOn,
      docketNumber: `${source.volume}US${entry.reportPage}`,
      caseName: entry.caseName,
      authorCode: null as null,
      citation: `${source.volume} U.S. ${entry.reportPage}`,
      pdfUrl: `${source.pdfUrl}#page=${startPage}`,
      startPage,
    };
  });
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
  let body: Uint8Array;
  if (MIRROR_DIR) {
    body = new Uint8Array(await readFile(path.join(MIRROR_DIR, "USReports.aspx")));
    if (body.byteLength > MAX_INDEX_BYTES) throw new Error(`Official source exceeds ${MAX_INDEX_BYTES} byte cap`);
  } else {
    const response = await fetch(INDEX_URL, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
    if (!response.ok) throw new Error(`Supreme Court U.S. Reports index returned HTTP ${response.status}`);
    body = await boundedBody(response, MAX_INDEX_BYTES);
  }
  const rawBody = new TextDecoder().decode(body);
  return { sourceUri: INDEX_URL, rawBody, contentHash: createHash("sha256").update(body).digest("hex"),
    retrievedAt: new Date().toISOString(), volumes: parseOfficialBoundVolumeIndex(rawBody) };
}

export async function fetchOfficialBoundVolume(source: OfficialBoundVolume) {
  const url = officialPdfUrl(source.pdfUrl);
  let body: Uint8Array;
  if (MIRROR_DIR) {
    const fileName = officialBoundVolumeMirrorFileName(source.volume);
    body = new Uint8Array(await readFile(path.join(MIRROR_DIR, fileName)));
    if (body.byteLength > MAX_VOLUME_BYTES) throw new Error(`Official source exceeds ${MAX_VOLUME_BYTES} byte cap`);
  } else {
    const response = await fetch(url, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
    if (!response.ok) throw new Error(`Supreme Court bound volume returned HTTP ${response.status}`);
    body = await boundedBody(response, MAX_VOLUME_BYTES);
  }
  if (body[0] !== 0x25 || body[1] !== 0x50 || body[2] !== 0x44 || body[3] !== 0x46) throw new Error("Official bound-volume response is not a PDF");
  return { sourceUri: url, body, contentHash: createHash("sha256").update(body).digest("hex"),
    retrievedAt: new Date().toISOString(), mediaType: "application/pdf" };
}
