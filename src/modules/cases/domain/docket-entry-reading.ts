/**
 * Reads a docket line the way the court wrote it. A kind is a label for the
 * line. An outcome is repeated only when the line itself states one. A party
 * is named only when that party's name appears in the line.
 */

export type DocketEntryKind = "complaint" | "motion" | "order" | "summons" | "notice" | "other";

const KINDS: Array<[DocketEntryKind, RegExp]> = [
  ["order", /\border\b/i],
  ["motion", /\bmotion\b/i],
  ["complaint", /\bcomplaint\b/i],
  ["summons", /\bsummons\b/i],
  ["notice", /\bnotice\b/i],
];

const STATED_OUTCOME = /\b(granted|granting|denied|denying|dismissed|remanded|vacated|affirmed|judgment entered)\b/i;

export function docketEntryKind(description: string): DocketEntryKind {
  for (const [kind, pattern] of KINDS) {
    if (pattern.test(description)) return kind;
  }
  return "other";
}

/** A short slice of the court's own words around a stated outcome, or null. */
export function statedOutcome(description: string): string | null {
  const match = STATED_OUTCOME.exec(description);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - 48);
  const end = Math.min(description.length, match.index + match[0].length + 48);
  return description.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Party names of at least four letters that the entry actually contains. */
export function namedParties(description: string, partyNames: readonly string[]): string[] {
  const haystack = description.toLowerCase();
  const found: string[] = [];
  for (const name of partyNames) {
    const trimmed = name.trim();
    if (trimmed.length < 4) continue;
    if (!haystack.includes(trimmed.toLowerCase())) continue;
    if (found.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    found.push(trimmed);
  }
  return found;
}

export const DOCKET_FEED_NOTE = "Docket entries from the court's free public feed since Jurvio began monitoring; may be incomplete.";
export const ALLEGATION_NOTE = "Allegations are not findings of liability.";
