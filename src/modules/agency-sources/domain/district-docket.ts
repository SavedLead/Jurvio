/**
 * District-court docket numbers as official documents write them:
 * "6:26-cv-05267-JDA", "No. 5:26-CR-194-FL-RJ", "26-cr-80031", "25-CR-2060",
 * "1:26cv2615", SDNY "26 Civ. 1234" / "26 Cr. 123", C.D. Cal. "CR 26-00123".
 * Only the office, year, case type and sequence number identify the case;
 * judge initials and defendant numbers after them are dropped.
 */
export interface DistrictDocket {
  office: string | null;
  year: string;
  caseType: string;
  sequence: string;
  /** "6:26-cv-05267", or "26-cr-80031" when the document gives no office number. */
  canonical: string;
  raw: string;
  index: number;
}

const TYPE_ALIASES: Record<string, string> = {
  cv: "cv", civ: "cv", cr: "cr", crim: "cr", mj: "mj", mag: "mj", mc: "mc", misc: "mc", md: "md", mdl: "md",
  po: "po", sw: "sw", ml: "ml", pt: "pt", dp: "dp", gj: "gj", cb: "cb",
};

const TYPES = "cv|cr|mj|mc|md|po|sw|ml|pt|dp|cb";
const STANDARD = new RegExp(String.raw`(?<![\w:./-])(?:(\d{1,2})\s?:\s?)?((?:19|20)?\d{2})(?:\s?-\s?|)(${TYPES})(?:\s?-\s?|)(\d{1,6})(?![\d])((?:-[A-Za-z]{1,4}){0,4}(?:-\d{1,3})?)`, "gi");
const SDNY = /(?<![\w])(\d{2})\s+(Civ|Cr|Crim|Mag|Misc)\.?\s+(\d{1,6})(?!\d)/g;
const PREFIXED = /(?<![\w])(CR|CV)\s+(\d{2})-(\d{1,6})(?!\d)/g;

function build(office: string | null, year: string, type: string, sequence: string, raw: string, index: number, nowYear: number): DistrictDocket | null {
  const yy = year.slice(-2);
  const fullYear = Number(yy) + (Number(yy) > (nowYear % 100) + 1 ? 1900 : 2000);
  if (fullYear < 1970 || fullYear > nowYear + 1) return null;
  const caseType = TYPE_ALIASES[type.toLowerCase()];
  if (!caseType) return null;
  const seq = sequence.replace(/^0+(?=\d)/, "").padStart(5, "0");
  if (/^0+$/.test(seq)) return null;
  const officeValue = office ? String(Number(office)) : null;
  return {
    office: officeValue, year: yy, caseType, sequence: seq,
    canonical: `${officeValue ? `${officeValue}:` : ""}${yy}-${caseType}-${seq}`, raw: raw.trim(), index,
  };
}

/** Every district docket number a text states, deduplicated by canonical form (first occurrence kept). */
export function findDistrictDockets(text: string, now: Date = new Date()): DistrictDocket[] {
  const nowYear = now.getUTCFullYear();
  const found: DistrictDocket[] = [];
  for (const m of text.matchAll(STANDARD)) {
    // A 4-digit year with no separator ("2026cv1") is too loose; require the dash form for those.
    if (m[2]!.length === 4 && !/-/.test(m[0])) continue;
    const docket = build(m[1] ?? null, m[2]!, m[3]!, m[4]!, m[0], m.index ?? 0, nowYear);
    if (docket) found.push(docket);
  }
  for (const m of text.matchAll(SDNY)) {
    const docket = build(null, m[1]!, m[2]!, m[3]!, m[0], m.index ?? 0, nowYear);
    if (docket) found.push(docket);
  }
  for (const m of text.matchAll(PREFIXED)) {
    const docket = build(null, m[2]!, m[1]!, m[3]!, m[0], m.index ?? 0, nowYear);
    if (docket) found.push(docket);
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return found.filter((docket) => {
    if (seen.has(docket.canonical)) return false;
    seen.add(docket.canonical);
    return true;
  });
}

export function parseDistrictDocket(value: string, now?: Date): DistrictDocket | null {
  const found = findDistrictDockets(value, now);
  return found.length === 1 ? found[0]! : null;
}

/**
 * The normalized keys (legal_case_normalized_docket_idx form: lower, alphanumerics only)
 * a case with this docket can be stored under. With a stated office only that office
 * (and the bare form) is tried; without one every office 1-9 is, and more than one
 * hit is treated as ambiguous by the matcher.
 */
export function normalizedDocketKeys(docket: Pick<DistrictDocket, "office" | "year" | "caseType" | "sequence">): string[] {
  const sequences = [...new Set([docket.sequence, docket.sequence.replace(/^0+(?=\d)/, ""), docket.sequence.padStart(6, "0")])];
  const offices = docket.office ? [docket.office, ""] : ["", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const keys: string[] = [];
  for (const office of offices) for (const seq of sequences) keys.push(`${office}${docket.year}${docket.caseType}${seq}`);
  return [...new Set(keys)];
}
