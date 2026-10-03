export type CitationKind = "reporter" | "neutral" | "westlaw" | "lexis" | "unknown";

export interface ParsedCitation {
  display: string;
  lookupKey: string;
  kind: CitationKind;
  volume?: string;
  reporter?: string;
  page?: string;
  year?: string;
}

const reporterCitation = /^(\d{1,4})\s+([A-Za-z][A-Za-z.\d ]{0,24}?)\s+(\d{1,7})(?:\s*,\s*(?:at\s+)?\*?(\d{1,7}))?(?:\s*\(([^)]{2,80})\))?$/;
const westlawCitation = /^(\d{4})\s+WL\s+(\d{1,12})$/i;
const lexisCitation = /^(\d{4})\s+(?:U\.S\.\s+)?LEXIS\s+(\d{1,12})$/i;

export function normalizeCitationInput(value: string): string {
  return value.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").replace(/\s+,/g, ",").trim().slice(0, 180);
}

export function citationLookupKey(value: string): string {
  return normalizeCitationInput(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

export function parseCitation(value: string): ParsedCitation | null {
  const display = normalizeCitationInput(value);
  if (display.length < 5) return null;
  const westlaw = westlawCitation.exec(display);
  if (westlaw) return { display: `${westlaw[1]} WL ${westlaw[2]}`, lookupKey: citationLookupKey(display), kind: "westlaw", year: westlaw[1] };
  const lexis = lexisCitation.exec(display);
  if (lexis) return { display, lookupKey: citationLookupKey(display), kind: "lexis", year: lexis[1] };
  const reporter = reporterCitation.exec(display);
  if (reporter) {
    const normalizedReporter = reporter[2].replace(/\s+/g, " ").trim();
    return { display, lookupKey: citationLookupKey(`${reporter[1]} ${normalizedReporter} ${reporter[3]}`), kind: "reporter", volume: reporter[1], reporter: normalizedReporter, page: reporter[3] };
  }
  return { display, lookupKey: citationLookupKey(display), kind: "unknown" };
}
