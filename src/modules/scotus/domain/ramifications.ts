/**
 * "What this means going forward" for a decided Supreme Court case, free and
 * rule-based: the Court's own words (the syllabus "Held:" paragraph, or a
 * verified holding quote) plus how often later cases on Jurvio cite it and from
 * which courts. Nothing here is written by a model. Pure functions; no I/O.
 *
 * AI_IMPACT_SUMMARY_SLOT: a plain-English "impact" summary (what changed, who
 * is affected) would need a paid AI/LLM step and David's OK; it is not built.
 * The UI marks where it would go (case-ramifications.tsx).
 */

const RUNNING_HEAD = /\b(?:OCTOBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|NOVEMBER|DECEMBER)\s+TERM,\s+\d{4}\s+(?:Syllabus\s+)?(?:\d+\s+U\.\s*S\.\s*)?|\bCite\s+as:\s+\d+\s+U\.\s*S\.\s+[_\d]+\s+\(\d{4}\)\s*\d*\s*(?:Syllabus\s*)?|\b\d+\s+U\.\s*S\.\s+\d+\s+[A-Z][A-Z .,'’&-]+\s+v\.\s+[A-Z][A-Z .,'’&-]+\s+Syllabus\s+/g;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(RUNNING_HEAD, " ").replace(/([a-z])- ([a-z])/g, "$1$2").replace(/\s+/g, " ").trim();
}

/** "Pp. 322-326." / "P. 326." page markers the syllabus puts after each point. */
const PAGE_MARK = /\s*\bPp?\.\s*\d[\d\s,–—-]*\d?\.\s*/;

export interface SyllabusHolding {
  /** The first point of the "Held:" paragraph, verbatim (page markers removed). */
  text: string;
  /** More numbered or lettered points follow in the syllabus. */
  truncated: boolean;
}

/**
 * The opening "Held:" point of a Supreme Court syllabus. The syllabus is the
 * Reporter of Decisions' summary printed before the opinion (not part of the
 * opinion itself), so the page must say so. Null when no "Held:" is found
 * before the opinion begins.
 */
export function readSyllabusHeld(head: string | null | undefined, maxChars = 900): SyllabusHolding | null {
  if (!head) return null;
  const text = clean(head.slice(0, 40_000));
  const held = /\bHeld\s*:\s*/.exec(text);
  if (!held) return null;
  const delivered = text.search(/\b(?:(?:MR\.\s+)?(?:CHIEF\s+)?JUSTICE\s+)?[A-Z][A-Z'’-]+,\s+(?:C\.\s*)?J\.,?\s+delivered\s+the\s+opinion\b/);
  if (delivered >= 0 && delivered < held.index) return null;
  let body = text.slice(held.index + held[0].length, delivered > held.index ? delivered : undefined).trim();
  const mark = body.search(PAGE_MARK);
  let truncated = false;
  if (mark > 30) { truncated = body.slice(mark).replace(PAGE_MARK, "").trim().length > 40; body = body.slice(0, mark).trim(); }
  body = body.replace(/^1\.\s+/, "");
  if (body.length < 30) return null;
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".” "));
    body = stop > 200 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, "")} …`;
    truncated = true;
  }
  return { text: /[.?!][”"’]?$|…$/.test(body) ? body : `${body}.`, truncated };
}

export type CitingCourtKind = "supreme" | "appellate" | "district" | "state" | "other";

export interface CitingCourtRow {
  courtPublicId: string | null;
  courtName: string;
  courtKind: CitingCourtKind;
  cases: number;
}

export interface CitationReach {
  total: number;
  byKind: Record<CitingCourtKind, number>;
  topCourts: CitingCourtRow[];
  firstCitedOn: string | null;
  lastCitedOn: string | null;
  lastFiveYears: number;
}

/** Group citing-court rows into a reach summary (top courts by count, ties by name). */
export function summarizeReach(rows: readonly CitingCourtRow[], span: { first: string | null; last: string | null; lastFiveYears: number }, top = 5): CitationReach {
  const byKind: Record<CitingCourtKind, number> = { supreme: 0, appellate: 0, district: 0, state: 0, other: 0 };
  let total = 0;
  for (const row of rows) { byKind[row.courtKind] += row.cases; total += row.cases; }
  const topCourts = [...rows].sort((a, b) => b.cases - a.cases || a.courtName.localeCompare(b.courtName)).slice(0, top);
  return { total, byKind, topCourts, firstCitedOn: span.first, lastCitedOn: span.last, lastFiveYears: span.lastFiveYears };
}

/** Court kind from a court's jurisdiction code and id (CourtListener style). */
export function citingCourtKind(jurisdiction: string | null, providerCourtId: string | null): CitingCourtKind {
  const id = (providerCourtId ?? "").toLowerCase();
  const j = (jurisdiction ?? "").toUpperCase();
  if (id === "scotus") return "supreme";
  if (/^ca(?:\d{1,2}|dc|fc)$/.test(id) || j === "F") return "appellate";
  if (j === "FD" || j === "FEDERAL DISTRICT" || j === "FB") return "district";
  if (j.startsWith("S")) return "state";
  return "other";
}
