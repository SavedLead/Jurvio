/**
 * Where a Supreme Court docket stands, read from the Court's own docket page
 * (supremecourt.gov): whether the petition was granted, denied or dismissed,
 * the judgment line when the Court decided the case, and the parties' titles.
 * Only the "Proceedings and Orders" table and the case header are read; the
 * attorney/contact blocks on the page are never parsed or stored.
 */
import { decodeHtml, parseOfficialDocket, type OfficialDocketEvent } from "./official-docket";

export const DOCKET_STATUS_PARSER_VERSION = "scotus-docket-status-v1";

export type CertStatus = "granted" | "denied" | "dismissed" | "pending";

export interface ScotusDocketStatus {
  docketNumber: string;
  sourceUrl: string;
  petitionerTitle: string | null;
  respondentTitle: string | null;
  lowerCourt: string | null;
  lowerCourtDecidedOn: string | null;
  docketedOn: string | null;
  certStatus: CertStatus;
  certStatusOn: string | null;
  certEntry: string | null;
  judgmentOn: string | null;
  judgmentEntry: string | null;
  lastEntryOn: string | null;
  entryCount: number;
}

/** Official docket page for a docket number: the 2017+ docket pages, and the 2000–2016 archive. */
export function officialDocketPageUrl(docketNumber: string): string | null {
  const value = docketNumber.trim();
  const match = /^(\d{2})(?:-\d{1,5}|A\d{1,4}|M\d{1,4})$/i.exec(value);
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  const now = new Date().getUTCFullYear() % 100;
  if (year > now + 1) return null;
  if (year >= 17) return `https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/${value}.html`;
  return `https://www.supremecourt.gov/search.aspx?filename=/docketfiles/${value}.htm`;
}

function cleanTitle(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim()
    .replace(/,?\s*(?:Petitioners?|Respondents?|Applicants?|Appellants?|Appellees?)\.?\s*$/i, "")
    .replace(/[,;]\s*$/, "").trim();
  return text.length >= 2 && text.length <= 300 ? text : null;
}

/** "Title: Philip Morris USA, Petitioner v. Mayola Williams, Personal Representative …" */
export function readDocketTitle(html: string): { petitioner: string | null; respondent: string | null } {
  const start = html.search(/Title:/i);
  if (start < 0) return { petitioner: null, respondent: null };
  const rest = html.slice(start + 6, start + 4000);
  const end = rest.search(/Docketed:|Lower\s+Ct:|Case\s+Nos?\.?:|Case\s+Numbers:/i);
  const text = decodeHtml(end > 0 ? rest.slice(0, end) : rest.slice(0, 600)).replace(/^[\s:]+/, "");
  const parts = text.split(/(?:^|\s+)v\.\s+/);
  if (parts.length < 2) return { petitioner: cleanTitle(text), respondent: null };
  return { petitioner: cleanTitle(parts[0] ?? ""), respondent: cleanTitle(parts.slice(1).join(" v. ")) };
}

const JUDGMENT = /^(?:(?:Petition\s+(?:for\s+(?:a\s+)?writ\s+of\s+certiorari\s+)?GRANTED[.;,]?\s*)?(?:The\s+)?Judgment\s+(?:is\s+)?(?:REVERSED|AFFIRMED|VACATED|MODIFIED)|Adjudged\s+to\s+be\s+(?:REVERSED|AFFIRMED)|(?:Writ\s+of\s+certiorari|Appeal)\s+DISMISSED|(?:Petition|Writ)\s+DISMISSED\s+as\s+improvidently\s+granted|Judgment\s+REVERSED|Reversed\s+and\s+remanded|Affirmed\s+by\s+an\s+equally\s+divided\s+Court)/i;

function judgmentLine(description: string): string {
  // Keep the judgment words; drop "Kagan, J., delivered the opinion …" and the vote lineup.
  const cut = description.split(/\s+(?:[A-Z][a-z]+,\s+(?:C\.\s*)?J\.,?\s+delivered|Opinion\s+per\s+curiam|Per\s+Curiam|\(Detached\s+Opinion\))/)[0] ?? description;
  return cut.trim().slice(0, 300);
}

export function readDocketStatus(events: OfficialDocketEvent[]): Pick<ScotusDocketStatus, "certStatus" | "certStatusOn" | "certEntry" | "judgmentOn" | "judgmentEntry" | "lastEntryOn" | "entryCount"> {
  let certStatus: CertStatus = "pending";
  let certStatusOn: string | null = null;
  let certEntry: string | null = null;
  let judgmentOn: string | null = null;
  let judgmentEntry: string | null = null;
  const ordered = [...events].sort((left, right) => (left.filedOn ?? "").localeCompare(right.filedOn ?? ""));
  for (const event of ordered) {
    const text = event.description.trim();
    if (JUDGMENT.test(text)) {
      judgmentOn = event.filedOn;
      judgmentEntry = judgmentLine(text);
      if (certStatus !== "granted") {
        // A judgment means the Court took the case (a summary "GRANTED. Judgment VACATED" order included).
        certStatus = "granted"; certStatusOn = event.filedOn; certEntry = text.slice(0, 300);
      }
      continue;
    }
    if (/^Petition\s+(?:for\s+(?:a\s+)?writ\s+of\s+certiorari\s+(?:before\s+judgment\s+)?)?DENIED\b/i.test(text)
      || /\bpetition\s+for\s+(?:a\s+)?writ\s+of\s+certiorari\s+(?:is\s+)?DENIED\b/i.test(text) && !/rehearing/i.test(text)) {
      certStatus = "denied"; certStatusOn = event.filedOn; certEntry = text.slice(0, 300);
      continue;
    }
    if (/^Petition\s+(?:for\s+(?:a\s+)?writ\s+of\s+certiorari\s+)?GRANTED\b/i.test(text)) {
      certStatus = "granted"; certStatusOn = event.filedOn; certEntry = text.slice(0, 300);
      continue;
    }
    if (/^(?:Petition|Writ\s+of\s+certiorari)\s+DISMISSED\b/i.test(text)
      || /\bpetition\s+for\s+(?:a\s+)?writ\s+of\s+certiorari\s+(?:is\s+)?DISMISSED\b/i.test(text)
      || /^Petition\s+(?:for\s+(?:a\s+)?writ\s+of\s+certiorari\s+)?DISMISSED\s+(?:pursuant\s+to|under)\s+Rule\s+46/i.test(text)) {
      certStatus = "dismissed"; certStatusOn = event.filedOn; certEntry = text.slice(0, 300);
    }
  }
  const lastEntryOn = ordered.at(-1)?.filedOn ?? null;
  return { certStatus, certStatusOn, certEntry, judgmentOn, judgmentEntry, lastEntryOn, entryCount: events.length };
}

/** Parse an official docket page into its status. Null when the page is not a docket ("no such docket"). */
export function parseDocketStatus(html: string, docketNumber: string, sourceUrl: string): ScotusDocketStatus | null {
  const docket = parseOfficialDocket(html, docketNumber, sourceUrl);
  if (docket.events.length === 0 && !/Docket\s+for\s+/i.test(html)) return null;
  const title = readDocketTitle(html);
  return {
    docketNumber: docket.docketNumber,
    sourceUrl,
    petitionerTitle: title.petitioner,
    respondentTitle: title.respondent,
    lowerCourt: docket.lowerCourtName,
    lowerCourtDecidedOn: docket.lowerCourtDecidedOn,
    docketedOn: docket.docketedOn,
    ...readDocketStatus(docket.events),
  };
}
