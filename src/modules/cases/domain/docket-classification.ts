/**
 * Labels a docket line from the words the court used. An outcome is repeated
 * only when the line states a result. A party is named only when that name
 * appears in the line. Jury demand and jurisdiction are read only from an
 * explicit phrase or from a statute already stored on the case.
 */

export type DocketEntryKind =
  | "complaint" | "motion" | "order" | "summons" | "notice" | "stipulation"
  | "judgment" | "letter" | "hearing" | "response" | "other";

const KINDS: Array<[DocketEntryKind, RegExp]> = [
  ["judgment", /\bjudg(?:e)?ments?\b/i],
  ["summons", /\bsummons(?:es)?\b/i],
  ["stipulation", /\bstipulations?\b/i],
  ["complaint", /\b(complaints?|petitions?)\b/i],
  ["notice", /\bnotices?\b/i],
  ["letter", /\bletters?\b/i],
  ["hearing", /\b(hearings?|conferences?)\b/i],
  ["response", /\b(responses?|answers?|replies|reply|oppositions?)\b/i],
  ["order", /\borders?\b/i],
  ["motion", /\bmotions?\b/i],
];

/** POSIX pattern for an order or judgment line. Kept in step with KINDS above. */
export const ORDER_LINE_PATTERN = String.raw`\m(orders?|judg(e)?ments?)\M`;

const KIND_LABEL: Record<DocketEntryKind, string> = {
  complaint: "Complaint",
  motion: "Motion",
  order: "Order",
  summons: "Summons",
  notice: "Notice",
  stipulation: "Stipulation",
  judgment: "Judgment",
  letter: "Letter",
  hearing: "Hearing",
  response: "Response",
  other: "Docket entry",
};

export const DOCKET_FEED_NOTE = "Docket entries from the court's free public feed since Jurvio began monitoring this case; may be incomplete.";
export const ALLEGATION_NOTE = "Allegations are not findings of liability.";

export function docketEntryKind(description: string): DocketEntryKind {
  const bracket = /\[([^\]]+)\]/.exec(description)?.[1];
  const source = bracket ?? description;
  for (const [kind, pattern] of KINDS) {
    if (pattern.test(source)) return kind;
  }
  return "other";
}

export function docketEntryKindLabel(kind: DocketEntryKind): string {
  return KIND_LABEL[kind];
}

export function isOrderKind(kind: DocketEntryKind): boolean {
  return kind === "order" || kind === "judgment";
}

/**
 * A short result phrase, or null. "Order on Motion to Dismiss" does not state
 * how the court ruled. "ORDER granting the motion" does.
 */
export function statedOutcome(description: string): string | null {
  const text = description.replace(/\s+/g, " ").trim();
  const match = /\b(granted in part(?: and denied in part)?|granting|granted|denied in part|denying|denied|dismissed|vacated|affirmed|remanded|judgment entered)\b/i.exec(text);
  if (!match?.[1]) return null;
  const verb = match[1].toLowerCase();
  if (verb === "dismissed" && /\bmotion to dismiss\b/i.test(text) && !/\b(is|was|be|been|hereby)\s+dismissed\b/i.test(text)) return null;
  if (verb === "judgment entered") return "Judgment entered";
  if (verb === "granting") return "Granted";
  if (verb === "denying") return "Denied";
  return verb.charAt(0).toUpperCase() + verb.slice(1);
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

const STATUTE_BASIS: Array<[RegExp, string]> = [
  [/\b1332\b|diversity jurisdiction/i, "Diversity"],
  [/\b1331\b|federal question/i, "Federal question"],
  [/\b1345\b/, "United States as plaintiff"],
  [/\b1346\b/, "United States as defendant"],
  [/\b1367\b|supplemental jurisdiction/i, "Supplemental"],
];

/** Jurisdiction basis only when a stored cause or docket line states it. */
export function jurisdictionBasisFromText(cause: string | null | undefined, lines: readonly string[]): string | null {
  const explicit = /jurisdiction(?:\s+basis)?\s*[:\-]\s*([A-Za-z][^.\n]{2,80})/i.exec(lines.join("\n"));
  if (explicit?.[1]) return explicit[1].replace(/\s+/g, " ").trim();
  const causeText = cause ?? "";
  for (const [pattern, label] of STATUTE_BASIS) {
    if (pattern.test(causeText)) return label;
  }
  return null;
}

/** Jury demand only when a stored line states who demanded a jury. */
export function juryDemandFromText(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = /jury demand\s*[:\-]?\s*(plaintiff|defendant|both|none)/i.exec(line);
    if (!match?.[1]) continue;
    const word = match[1].toLowerCase();
    if (word === "both") return "Both";
    if (word === "none") return "None";
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
}
