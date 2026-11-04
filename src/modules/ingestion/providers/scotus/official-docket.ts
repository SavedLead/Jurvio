import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const OFFICIAL_ORIGIN = "https://www.supremecourt.gov";
const MAX_DOCKET_BYTES = 4 * 1024 * 1024;

export interface OfficialDocketDocument {
  sourceRecordId: string;
  title: string;
  url: string;
  documentType: string;
  filedOn: string | null;
}

export interface OfficialDocketEvent {
  sourceRecordId: string;
  filedOn: string | null;
  description: string;
  eventType: string;
  documents: OfficialDocketDocument[];
}

export interface OfficialDocket {
  docketNumber: string;
  sourceUri: string;
  rawBody: string;
  contentHash: string;
  retrievedAt: string;
  docketedOn: string | null;
  lowerCourtName: string | null;
  lowerCourtCaseNumbers: string[];
  lowerCourtDecidedOn: string | null;
  events: OfficialDocketEvent[];
}

export function decodeHtml(value: string) {
  return value.replaceAll(/<br\s*\/?>/gi, "\n").replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"').replaceAll(/\s+/g, " ").trim();
}

export function isoLongDate(value: string): string | null {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value.trim());
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf((match[1] ?? "").toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2]?.padStart(2, "0")}`;
}

function officialLink(href: string, base: string) {
  const url = new URL(href.replaceAll("&amp;", "&"), base);
  if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.startsWith("/")) throw new Error("Docket link is not an official Supreme Court URL");
  return url.toString();
}

/**
 * Emergency-application event types (docket lines on "A" dockets), checked
 * before the general types. Uses the Court's fixed phrasing; the full
 * application classifier with plain English lives in
 * src/modules/scotus/domain/emergency-application.ts.
 */
// Periods of common abbreviations ("Moshe Bain, et al. filed") would end a "[^.]*" sentence match early.
const ABBREVIATION = /\b(et\s+al|Inc|Corp|Co|Ltd|Jr|Sr|Dr|Mr|Mrs|Ms|St|No|Nos|U\.\s?S|L\.\s?L\.\s?C)\./g;

function classifyApplicationLine(description: string): string | null {
  const text = description.replace(/\s+/g, " ").trim().replace(ABBREVIATION, "$1");
  if (/\badministrative(?:ly)?\s+stay(?:ed)?\b/i.test(text)
    || /^Order\s+entered\s+by\s+(?:The\s+Chief\s+Justice|Justice\s+[A-Z][A-Za-z'’-]+)\b[^.]*\bstayed\s+pending\s+further\s+order/i.test(text)) return "administrative_stay";
  // A ruling written as an order: "... it is ordered that the application for stay is denied without prejudice ...".
  const ordered = /\bit\s+is\s+(?:hereby\s+)?ordered\s+that\s+the\s+application\b[^.]*?\bis\s+(?:hereby\s+)?(granted\s+in\s+part|granted|denied)\b([^.]*)/i.exec(text);
  if (ordered?.[1]) {
    const verb = ordered[1].toLowerCase().replace(/\s+/g, " ");
    if (verb === "granted in part" || (verb === "granted" && /\b(?:otherwise|in\s+part)\s+denied\b|\bdenied\s+in\s+part\b/i.test(ordered[2] ?? ""))) return "application_granted_in_part";
    return verb === "granted" ? "application_granted" : "application_denied";
  }
  if (/^(?:The\s+)?Application\b[^.]*\b(?:denied|dismissed)\s+as\s+moot\b/i.test(text)) return "application_moot";
  if (/^Application\b[^.]*\bwithdrawn\b/i.test(text)) return "application_withdrawn";
  if (/^(?:The\s+)?Application\b[^.]*\b(?:is\s+)?granted\s+in\s+part\b/i.test(text)
    || /^(?:The\s+)?Application\b[^.]*\b(?:is\s+)?granted\b[^.]*\b(?:otherwise|in\s+all\s+other\s+respects)\s+denied\b/i.test(text)) return "application_granted_in_part";
  if (/^(?:The\s+)?Application\b[^.]*\breferred\s+to\s+the\s+Court\b[^.]*\bis\s+(?:hereby\s+)?granted\b/i.test(text)) return "application_granted";
  if (/^(?:The\s+)?Application\b[^.]*\breferred\s+to\s+the\s+Court\b[^.]*\bis\s+(?:hereby\s+)?denied\b/i.test(text)) return "application_denied";
  if (/^Application\b[^.]*\breferred\s+to\s+the\s+Court\.?$/i.test(text)) return "application_referred";
  if (/^(?:The\s+)?Application\b[^.]*\b(?:is\s+)?granted\b/i.test(text)) return "application_granted";
  if (/^(?:The\s+)?Application\b[^.]*\b(?:is\s+)?denied\b/i.test(text)) return "application_denied";
  if (/^(?:The\s+)?Application\b[^.]*\breferred\s+to\s+the\s+Court\b/i.test(text)) return "application_referred";
  if (/^Response\s+to\s+application\b[^.]*\brequested\s+by\b/i.test(text)) return "response_requested";
  if (/^Response\s+to\s+application\b[^.]*\bfiled\b/i.test(text)) return "application_response_filed";
  if (/^Reply\b[^.]*\bin\s+support\s+of\s+(?:the\s+)?application\b/i.test(text)) return "application_reply_filed";
  if (/^Application\b[^.]*\b(?:re-?submitted|renewed)\b/i.test(text)) return "application_resubmitted";
  if (/^Application\b[^.]*\bsubmitted\s+to\b/i.test(text)) return "application_submitted";
  return null;
}

/** Event types that make an entry "high" importance (case page and alerts). */
export const HIGH_IMPORTANCE_EVENTS: ReadonlySet<string> = new Set([
  "petition_filed", "certiorari_granted", "oral_argument", "decision", "mandate_issued",
  "application_granted", "application_granted_in_part", "application_denied", "administrative_stay", "application_referred", "response_requested",
]);

export function classifyEvent(description: string) {
  const application = classifyApplicationLine(description);
  if (application) return application;
  const value = description.toLowerCase();
  if (value.includes("petition for a writ of certiorari filed")) return "petition_filed";
  if (value.includes("judgment and mandate issued")) return "mandate_issued";
  if (value.includes("judgment reversed") || value.includes("judgment affirmed") || value.includes("judgment vacated") || value.includes("opinion per curiam")) return "decision";
  if (value.includes("petition granted")) return "certiorari_granted";
  if (value.includes("argument")) return "oral_argument";
  if (value.includes("distributed for conference")) return "conference_distribution";
  if (value.includes("brief")) return "brief_filed";
  if (value.includes("order")) return "order";
  return "docket_activity";
}

function classifyDocument(title: string, url: string) {
  const value = `${title} ${url}`.toLowerCase();
  if (value.includes("transcript")) return "oral_argument_transcript";
  if (value.includes("audio") || value.endsWith(".mp3")) return "oral_argument_audio";
  if (value.includes("appendix")) return "petition_appendix";
  if (value.includes("petition")) return "petition";
  if (value.includes("reply")) return "reply_brief";
  if (value.includes("brief")) return "brief";
  if (value.includes("order") || value.includes("mandate")) return "order";
  if (value.includes("opinion")) return "judicial_opinion";
  return "court_filing";
}

export function officialDocketSlug(value: string) {
  const docketNumber = value.trim();
  const original = /^(\d+),\s*Orig[.]?$/i.exec(docketNumber);
  if (original?.[1]) return `22o${original[1]}`;
  const linkedApplication = /^([0-9]{2}-[0-9]+)\s+\([0-9]{2}A[0-9]+\)$/i.exec(docketNumber);
  if (linkedApplication?.[1]) return linkedApplication[1];
  if (/^[0-9A-Za-z-]+$/.test(docketNumber)) return docketNumber;
  throw new Error("Unsupported Supreme Court docket number");
}

function labeledValue(html: string, label: string) {
  const pattern = new RegExp(`${label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(?:<[^>]+>\\s*)*([^<\\r\\n]+)`, "i");
  return decodeHtml(pattern.exec(html)?.[1] ?? "") || null;
}

export function parseOfficialDocket(html: string, docketNumber: string, sourceUri: string): Omit<OfficialDocket, "contentHash" | "retrievedAt"> {
  const normalizedDocket = docketNumber.trim();
  if (!/^[0-9A-Za-z-]+$/.test(normalizedDocket)) throw new Error("Unsupported Supreme Court docket number");
  const docketedOn = isoLongDate(labeledValue(html, "Docketed") ?? "");
  const lowerCourtName = labeledValue(html, "Lower Ct");
  const lowerNumbers = (labeledValue(html, "Case Numbers") ?? "")
    .replace(/^\(|\)$/g, "").split(/\)\s*\(|,\s*/).map((value) => value.trim()).filter(Boolean);
  const lowerCourtDecidedOn = isoLongDate(labeledValue(html, "Decision Date") ?? "");
  const events: OfficialDocketEvent[] = [];
  let eventIndex = 0;
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...((row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi))].map((cell) => cell[1] ?? "");
    if (cells.length < 2) continue;
    const dateText = decodeHtml(cells[0] ?? "");
    const filedOn = isoLongDate(dateText);
    if (!filedOn) continue;
    const detailHtml = cells.slice(1).join(" ");
    const description = decodeHtml(detailHtml);
    if (!description) continue;
    eventIndex += 1;
    const eventId = `${normalizedDocket}:event:${filedOn}:${eventIndex}`;
    const documents: OfficialDocketDocument[] = [];
    let documentIndex = 0;
    for (const link of detailHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const title = decodeHtml(link[2] ?? "") || "Court document";
      const url = officialLink(link[1] ?? "", sourceUri);
      documentIndex += 1;
      documents.push({ sourceRecordId: `${eventId}:document:${documentIndex}`, title, url,
        documentType: classifyDocument(title, url), filedOn });
    }
    events.push({ sourceRecordId: eventId, filedOn, description, eventType: classifyEvent(description), documents });
  }
  return { docketNumber: normalizedDocket, sourceUri, rawBody: html, docketedOn, lowerCourtName,
    lowerCourtCaseNumbers: lowerNumbers, lowerCourtDecidedOn, events };
}

export async function fetchOfficialDocket(docketNumber: string): Promise<OfficialDocket> {
  const docketSlug = officialDocketSlug(docketNumber);
  const sourceUri = `${OFFICIAL_ORIGIN}/docket/docketfiles/html/public/${docketSlug}.html`;
  const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR;
  if (artifactRoot) {
    try {
      const bytes = new Uint8Array(await readFile(join(artifactRoot, "scotus-docket-mirror", `${docketSlug}.html`)));
      if (bytes.byteLength > MAX_DOCKET_BYTES) throw new Error("Supreme Court docket exceeds byte cap");
      const rawBody = new TextDecoder().decode(bytes);
      return { ...parseOfficialDocket(rawBody, docketSlug, sourceUri),
        contentHash: createHash("sha256").update(bytes).digest("hex"), retrievedAt: new Date().toISOString() };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  const response = await fetch(sourceUri, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court docket returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_DOCKET_BYTES) throw new Error("Supreme Court docket exceeds byte cap");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCKET_BYTES) throw new Error("Supreme Court docket exceeds byte cap");
  const rawBody = new TextDecoder().decode(bytes);
  return { ...parseOfficialDocket(rawBody, docketSlug, sourceUri),
    contentHash: createHash("sha256").update(bytes).digest("hex"), retrievedAt: new Date().toISOString() };
}
