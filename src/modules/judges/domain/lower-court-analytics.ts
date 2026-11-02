/**
 * Rule-based helpers for lower-court judge analytics (case-depth feature 4).
 * Everything here is deterministic. Party labels describe the appointing
 * president only, as recorded by the Federal Judicial Center (FJC). They are
 * never turned into "liberal" or "conservative": no coded source of lower-court
 * judges' votes is used here.
 */

export const FJC_BIOGRAPHICAL_DIRECTORY_URL = "https://www.fjc.gov/history/judges";

export type AppointingParty = "republican" | "democratic" | "other" | "none" | "unknown";

/** Normalize the FJC "Party of Appointing President" field. */
export function appointingParty(value: string | null | undefined): AppointingParty {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "unknown";
  if (text === "republican") return "republican";
  if (text === "democratic" || text === "democrat") return "democratic";
  if (text.startsWith("none")) return "none";
  return "other";
}

/** Plain-English appointment line. Never says liberal/conservative. */
export function appointmentPhrase(president: string | null, partyValue: string | null): string {
  const party = appointingParty(partyValue);
  const who = president?.trim() ? `President ${president.trim()}` : null;
  switch (party) {
    case "republican": return who ? `Appointed by ${who}, a Republican president` : "Appointed by a Republican president";
    case "democratic": return who ? `Appointed by ${who}, a Democratic president` : "Appointed by a Democratic president";
    case "other": return who ? `Appointed by ${who} (${partyValue!.trim()} party)` : `Appointed by a ${partyValue!.trim()} president`;
    case "none": return "Assigned or reassigned to this court without a new presidential appointment (FJC record)";
    default: return who ? `Appointed by ${who}; the FJC record does not list a party` : "The FJC record does not show who appointed this judge";
  }
}

const TITLE_WORDS = new Set([
  "before", "circuit", "circuits", "judge", "judges", "chief", "senior", "district", "justice", "justices",
  "associate", "honorable", "hon", "the", "presiding", "sitting", "by", "designation", "u.s", "us", "court",
  "of", "appeals", "for", "magistrate", "bankruptcy", "retired", "panel", "per", "curiam", "en", "banc",
]);

/**
 * Split a reporter "judges" line (e.g. "Before SMITH, JONES, and BROWN, Circuit
 * Judges." or "Smith, Jones, Brown") into surname-like tokens. Returns
 * lower-case surnames in order, duplicates removed. Names it cannot read are
 * dropped rather than guessed.
 */
export function parsePanelSurnames(text: string | null | undefined): string[] {
  if (!text) return [];
  const cleaned = text
    .replace(/\*+/g, " ")
    .replace(/\((?:[^()]*)\)/g, " ")
    .replace(/\b(?:sitting by designation|by designation)\b/gi, " ")
    .replace(/[;:\n]/g, ",")
    .replace(/\s+and\s+/gi, ",")
    .replace(/&/g, ",");
  const out: string[] = [];
  for (const raw of cleaned.split(",")) {
    const words = raw.replace(/[.]/g, " ").split(/\s+/).map((word) => word.trim()).filter(Boolean);
    const kept = words.filter((word) => !TITLE_WORDS.has(word.toLowerCase()) && !/^(jr|sr|ii|iii|iv)$/i.test(word));
    if (!kept.length) continue;
    // Surname is the last meaningful word; skip single initials.
    const surname = [...kept].reverse().find((word) => word.replace(/[^A-Za-z'-]/g, "").length > 1);
    if (!surname) continue;
    const key = surname.toLowerCase().replace(/[^a-z'-]/g, "");
    if (key.length > 1 && !out.includes(key)) out.push(key);
  }
  return out;
}

export type AppealsOutcome = "affirmed" | "reversed" | "vacated" | "mixed" | "dismissed" | "remanded" | "review_granted" | "review_denied";

/** Map the shared plain-English outcome reading to the stored appeals outcome. */
export function appealsOutcomeOf(kind: string): AppealsOutcome | null {
  switch (kind) {
    case "affirmed": case "reversed": case "vacated": case "mixed": case "dismissed": case "remanded": return kind;
    case "review-granted": return "review_granted";
    case "review-denied": return "review_denied";
    default: return null;
  }
}

/** Surname keys a reporter name could match: "jackson-akiwumi" also matches "akiwumi". */
export function observedKeys(surname: string): string[] {
  const keys = new Set([surname]);
  if (surname.includes("-")) { keys.add(surname.split("-").at(-1)!); keys.add(surname.replace(/-/g, "")); }
  return [...keys].filter((key) => key.length > 1);
}

/** Keys an FJC normalized name answers to: last word, and last two words hyphenated or joined. */
export function rosterKeys(normalizedName: string): string[] {
  const parts = normalizedName.toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/).filter((part) => part && !/^(jr|sr|ii|iii|iv)$/.test(part));
  const last = parts.at(-1);
  if (!last) return [];
  const keys = new Set([last]);
  const prev = parts.at(-2);
  if (prev && parts.length >= 3) { keys.add(`${prev}-${last}`); keys.add(`${prev}${last}`); }
  return [...keys];
}

/** Median of a list of non-negative day counts, or null when empty. */
export function medianDays(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Percent with one decimal, or null with no sample. */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Plain duration, e.g. "about 11 months" / "45 days" / "about 2.3 years". */
export function plainDuration(days: number | null): string {
  if (days === null) return "Not enough data";
  if (days < 60) return `${days} days`;
  if (days < 730) return `about ${Math.round(days / 30.44)} months`;
  return `about ${(days / 365.25).toFixed(1)} years`;
}
