/**
 * "Key dates ahead": hearings, trial dates and filing deadlines that a public docket entry sets
 * for a future day. Fixed patterns only; each date keeps the entry's own words, and the page
 * says schedules change and that only dates written on the docket appear.
 */

export type KeyDateKind = "hearing" | "trial" | "conference" | "argument" | "deadline" | "sentencing";

export interface KeyDate {
  date: string;
  time: string | null;
  kind: KeyDateKind;
  label: string;
  plain: string;
  quote: string;
  setOn: string | null;
  entryNumber: string | null;
  entryPublicId: string | null;
}

export interface KeyDateEntry { publicId?: string | null; entryNumber?: string | number | null; filedOn: string | null; description: string }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE = String.raw`(\d{1,2})/(\d{1,2})/(\d{2,4})|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})`;
const TIME = String.raw`(?:\s*(?:at|@)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)))?`;

const RULES: Array<{ kind: KeyDateKind; label: string; plain: string; pattern: RegExp }> = [
  { kind: "sentencing", label: "Sentencing", plain: "The judge is scheduled to announce the sentence.", pattern: /\bsentencing\b[^.;]{0,80}?\b(?:set|reset|scheduled|continued)\s+(?:for|to)\s+/i },
  { kind: "trial", label: "Trial", plain: "The trial is scheduled to start.", pattern: /\b(?:jury\s+|bench\s+)?trial\b[^.;]{0,80}?\b(?:set|reset|scheduled|continued)\s+(?:for|to)\s+/i },
  { kind: "argument", label: "Oral argument", plain: "Lawyers argue the case before the judges.", pattern: /\b(?:oral\s+argument|argument)\b[^.;]{0,60}?\b(?:set|scheduled|calendared)\s+(?:for|on)\s+/i },
  { kind: "conference", label: "Conference", plain: "The judge meets with the lawyers to manage the case schedule.", pattern: /\b(?:status|scheduling|pretrial|settlement|rule\s+16)\s+conference\b[^.;]{0,80}?\b(?:set|reset|scheduled|continued)\s+(?:for|to)\s+/i },
  { kind: "hearing", label: "Hearing", plain: "A court session where the judge hears from the parties.", pattern: /\bhearing\b[^.;]{0,80}?\b(?:set|reset|scheduled|continued)\s+(?:for|to)\s+/i },
  { kind: "deadline", label: "Filing deadline", plain: "A filing is due to the court by this date.", pattern: /\b(?:responses?|repl(?:y|ies)|answer|briefs?|objections?|amended\s+complaint)\b[^.;]{0,60}?\bdue\s+(?:by\s+|on\s+)?/i },
];

function isoOf(match: RegExpExecArray, offset: number): string | null {
  let year: number; let month: number; let day: number;
  if (match[offset]) {
    month = Number(match[offset]); day = Number(match[offset + 1]); year = Number(match[offset + 2]);
    if (year < 100) year += 2000;
  } else {
    month = MONTHS[(match[offset + 3] ?? "").slice(0, 4).toLowerCase().replace(/[^a-z]/g, "")] ?? MONTHS[(match[offset + 3] ?? "").slice(0, 3).toLowerCase()] ?? 0;
    day = Number(match[offset + 4]); year = Number(match[offset + 5]);
  }
  if (!month || month > 12 || !day || day > 31 || year < 1990 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? iso : null;
}

const SKIP = /\b(sealed|ex\s+parte|under\s+seal|restricted)\b/i;
const VACATED = /\b(vacated|cancel(?:l)?ed|terminated|stricken|withdrawn)\b/i;

/** Future dates set on the docket, soonest first; when a later entry resets the same kind of event, the later entry wins. */
export function readKeyDatesAhead(entries: KeyDateEntry[], today: string, limit = 6, closedOn: string | null = null): KeyDate[] {
  const ordered = [...entries].filter((entry) => entry.description && !SKIP.test(entry.description))
    .sort((a, b) => (a.filedOn ?? "").localeCompare(b.filedOn ?? ""));
  const found: KeyDate[] = [];
  const latestByKind = new Map<KeyDateKind, KeyDate>();
  for (const entry of ordered) {
    const text = entry.description.replace(/\s+/g, " ").trim();
    // One event per sentence: the first rule that matches it (so "Trial set for …" is not also read as a hearing).
    for (const sentence of text.split(/(?<=[.;])\s+(?=[A-Z])/)) {
      for (const rule of RULES) {
        const lead = rule.pattern.exec(sentence);
        if (!lead) continue;
        const rest = sentence.slice(lead.index + lead[0].length);
        const match = new RegExp(`^(?:${DATE})${TIME}`, "i").exec(rest);
        if (!match) continue;
        const date = isoOf(match, 1);
        if (!date) break;
        const quoteStart = Math.max(0, lead.index - 40);
        const item: KeyDate = {
          date, time: match[7]?.replace(/\s+/g, " ").toUpperCase().replace(/\./g, "") ?? null, kind: rule.kind, label: rule.label, plain: rule.plain,
          quote: `${quoteStart > 0 ? "…" : ""}${sentence.slice(quoteStart, lead.index + lead[0].length + match[0].length).trim()}`,
          setOn: entry.filedOn, entryNumber: entry.entryNumber == null ? null : String(entry.entryNumber), entryPublicId: entry.publicId ?? null,
        };
        // A later entry that resets the same kind of event replaces the earlier one (deadlines are kept separately).
        if (rule.kind !== "deadline") latestByKind.set(rule.kind, item);
        else found.push(item);
        break;
      }
    }
    // "Hearing vacated" with no new date drops the pending event of that kind.
    for (const rule of RULES) {
      if (rule.kind === "deadline") continue;
      const word = rule.label.toLowerCase().split(" ")[0]!;
      if (VACATED.test(text) && new RegExp(`\\b${word}\\b`, "i").test(text) && !new RegExp(`(?:${DATE})`, "i").test(text)) latestByKind.delete(rule.kind);
    }
  }
  // A date set before the case closed is moot: the case ended first.
  return [...found, ...latestByKind.values()].filter((item) => item.date >= today && !(closedOn && item.setOn && item.setOn <= closedOn))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}
