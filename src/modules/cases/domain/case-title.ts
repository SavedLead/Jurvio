import { docketCaseType, type CourtKind } from "./record-answers";

/**
 * Bluebook-style page titles: "United States v. Olsen, No. 1:26-cr-00123 (E.D. Cal. 2026)".
 * Built only from the caption, docket number, court name / CourtListener court id
 * and the filed or decided year. Nothing is looked up or inferred.
 */
const STATES: Record<string, [string, string]> = {
  AL: ["Alabama", "Ala."], AK: ["Alaska", "Alaska"], AZ: ["Arizona", "Ariz."], AR: ["Arkansas", "Ark."],
  CA: ["California", "Cal."], CO: ["Colorado", "Colo."], CT: ["Connecticut", "Conn."], DE: ["Delaware", "Del."],
  DC: ["District of Columbia", "D.C."], FL: ["Florida", "Fla."], GA: ["Georgia", "Ga."], HI: ["Hawaii", "Haw."],
  ID: ["Idaho", "Idaho"], IL: ["Illinois", "Ill."], IN: ["Indiana", "Ind."], IA: ["Iowa", "Iowa"],
  KS: ["Kansas", "Kan."], KY: ["Kentucky", "Ky."], LA: ["Louisiana", "La."], ME: ["Maine", "Me."],
  MD: ["Maryland", "Md."], MA: ["Massachusetts", "Mass."], MI: ["Michigan", "Mich."], MN: ["Minnesota", "Minn."],
  MS: ["Mississippi", "Miss."], MO: ["Missouri", "Mo."], MT: ["Montana", "Mont."], NE: ["Nebraska", "Neb."],
  NV: ["Nevada", "Nev."], NH: ["New Hampshire", "N.H."], NJ: ["New Jersey", "N.J."], NM: ["New Mexico", "N.M."],
  NY: ["New York", "N.Y."], NC: ["North Carolina", "N.C."], ND: ["North Dakota", "N.D."], OH: ["Ohio", "Ohio"],
  OK: ["Oklahoma", "Okla."], OR: ["Oregon", "Or."], PA: ["Pennsylvania", "Pa."], RI: ["Rhode Island", "R.I."],
  SC: ["South Carolina", "S.C."], SD: ["South Dakota", "S.D."], TN: ["Tennessee", "Tenn."], TX: ["Texas", "Tex."],
  UT: ["Utah", "Utah"], VT: ["Vermont", "Vt."], VA: ["Virginia", "Va."], WA: ["Washington", "Wash."],
  WV: ["West Virginia", "W. Va."], WI: ["Wisconsin", "Wis."], WY: ["Wyoming", "Wyo."], GU: ["Guam", "Guam"],
  PR: ["Puerto Rico", "P.R."], VI: ["Virgin Islands", "V.I."], MP: ["Northern Mariana Islands", "N. Mar. I."],
};

const DIRECTIONS: Record<string, string> = {
  n: "N.D.", s: "S.D.", e: "E.D.", w: "W.D.", m: "M.D.", c: "C.D.",
  northern: "N.D.", southern: "S.D.", eastern: "E.D.", western: "W.D.", middle: "M.D.", central: "C.D.",
};

const CIRCUIT_ORDINALS: Record<string, string> = {
  first: "1st", second: "2d", third: "3d", fourth: "4th", fifth: "5th", sixth: "6th",
  seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th", eleventh: "11th",
};
const CIRCUIT_NUMBERS = ["", "1st", "2d", "3d", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th"];

/** Bluebook rule 6.1(a): adjacent single capitals close up ("E.D.N.Y."), others keep a space ("E.D. Cal."). */
function joinCourt(prefix: string, state: string) {
  return /^([A-Z]\.)+$/.test(state) ? `${prefix}${state}` : `${prefix} ${state}`;
}

function districtFromParts(direction: string | null, state: string) {
  return joinCourt(direction ?? "D.", state);
}

function abbreviationFromCode(code: string): string | null {
  const value = code.trim().toLowerCase();
  if (value === "scotus") return "U.S.";
  if (value === "cadc") return "D.C. Cir.";
  if (value === "cafc") return "Fed. Cir.";
  const circuit = /^ca(\d{1,2})$/.exec(value);
  if (circuit?.[1]) return CIRCUIT_NUMBERS[Number(circuit[1])] ? `${CIRCUIT_NUMBERS[Number(circuit[1])]} Cir.` : null;
  if (value === "dcd") return "D.D.C.";
  if (value === "nmid") return "D.N. Mar. I.";
  if (value === "gud") return "D. Guam";
  const district = /^([a-z]{2})([nsewmc]?)d$/.exec(value);
  if (district?.[1]) {
    const state = STATES[district[1].toUpperCase()];
    if (!state) return null;
    return districtFromParts(district[2] ? DIRECTIONS[district[2]] ?? null : null, state[1]);
  }
  return null;
}

function abbreviationFromName(name: string): string | null {
  const value = name.replace(/\s+/g, " ").trim();
  if (/supreme court of the united states/i.test(value)) return "U.S.";
  if (/district of columbia circuit/i.test(value)) return "D.C. Cir.";
  if (/federal circuit/i.test(value)) return "Fed. Cir.";
  const circuit = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh)\s+circuit\b/i.exec(value);
  if (circuit?.[1] && /appeals|circuit court/i.test(value)) return `${CIRCUIT_ORDINALS[circuit[1].toLowerCase()]} Cir.`;
  if (/bankruptcy/i.test(value)) return null;
  if (/\bdistrict of columbia\b/i.test(value)) return "D.D.C.";
  const district = /\b(?:(northern|southern|eastern|western|middle|central)\s+)?district\s+of\s+(?:the\s+)?([a-z .]+?)(?:\s*[,(-]|$)/i.exec(value);
  if (district?.[2]) {
    const stateName = district[2].trim().toLowerCase();
    const state = Object.values(STATES).find(([full]) => full.toLowerCase() === stateName);
    if (!state) return null;
    if (state[1] === "D.C.") return "D.D.C.";
    return districtFromParts(district[1] ? DIRECTIONS[district[1].toLowerCase()] ?? null : null, state[1]);
  }
  return null;
}

export function courtAbbreviation(courtName: string, providerCourtId?: string | null): string | null {
  return (providerCourtId ? abbreviationFromCode(providerCourtId) : null) ?? abbreviationFromName(courtName);
}

const GOVERNMENT_PARTY = /^(?:the\s+)?(?:usa|u\.\s?s\.\s?a\.?|u\.\s?s\.|united states(?: of america)?)$/i;
const NOT_A_DEFENDANT_NAME = /\b(?:v|vs)\.?\s|\bin re\b|\bmatter of\b|\bex parte\b|\bunited states\b|\busa\b|\bsealed\b|\bpetition\b|\bestate of\b|\bsearch warrant\b|\bseizure\b|\bapplication\b|\bgrand jury\b|\bunknown\b/i;

/**
 * Display caption. Federal criminal dockets in a district court (docket types
 * "cr", magistrate "mj" and petty offense "po") are prosecuted by the United States, so a bare defendant
 * caption such as "Olsen" becomes "United States v. Olsen". "USA v. X" is
 * normalized to "United States v. X". Everything else is returned unchanged.
 */
export function displayCaption(caption: string, docketNumber: string, courtKind: CourtKind | undefined): string {
  // Drop PACER caption tags such as "(HC) " (E.D. Cal. habeas); record-answers reads them via captionTag().
  const value = caption.replace(/\s+/g, " ").trim().replace(/^\([A-Z]{2}\)\s+/, "");
  const adversarial = /^(.+?)\s+(?:v|vs)\.?\s+(.+)$/i.exec(value);
  if (adversarial?.[1] && adversarial[2] && GOVERNMENT_PARTY.test(adversarial[1].trim())) {
    return `United States v. ${adversarial[2].trim()}`;
  }
  if (
    value
    && courtKind === "district"
    && ["cr", "mj", "po"].includes(docketCaseType(docketNumber) ?? "")
    && !adversarial
    && !NOT_A_DEFENDANT_NAME.test(value)
    && /[a-z]/i.test(value)
    && value.length <= 120
  ) {
    return `United States v. ${value}`;
  }
  return value;
}

export interface CaseTitleInput {
  caption: string;
  docketNumber: string;
  courtName: string;
  providerCourtId?: string | null;
  filedOn: string | null;
  decidedOn: string | null;
}

export const CASE_TITLE_TARGET_LENGTH = 60;

function year(input: CaseTitleInput) {
  const date = input.decidedOn ?? input.filedOn;
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;
}

// Bluebook T6 abbreviations, applied only when a title is too long.
const T6: Array<[RegExp, string]> = [
  [/\bAssociation\b/g, "Ass'n"], [/\bAssociates\b/g, "Assocs."], [/\bManufacturers\b/g, "Mfrs."],
  [/\bManufacturing\b/g, "Mfg."], [/\bCommission\b/g, "Comm'n"], [/\bCommissioner\b/g, "Comm'r"],
  [/\bSecurities\b/g, "Sec."], [/\bExchange\b/g, "Exch."], [/\bDepartment\b/g, "Dep't"],
  [/\bCorporation\b/g, "Corp."], [/\bCompany\b/g, "Co."], [/\bIncorporated\b/g, "Inc."],
  [/\bInternational\b/g, "Int'l"], [/\bNational\b/g, "Nat'l"], [/\bGovernment\b/g, "Gov't"],
  [/\bInsurance\b/g, "Ins."], [/\bUniversity\b/g, "Univ."], [/\bServices\b/g, "Servs."],
  [/\bAdministration\b/g, "Admin."], [/\bAmerica\b/g, "Am."], [/\bAmerican\b/g, "Am."],
  [/\bDistrict\b/g, "Dist."], [/\bCounty\b/g, "Cnty."], [/\bBoard\b/g, "Bd."],
  [/\bEducation\b/g, "Educ."], [/\bHospital\b/g, "Hosp."], [/\bLimited\b/g, "Ltd."],
  [/\bManagement\b/g, "Mgmt."], [/\bTechnologies\b/g, "Techs."], [/\bTechnology\b/g, "Tech."],
  [/\band\b/g, "&"],
];

function truncateWords(text: string, budget: number) {
  if (text.length <= budget) return text;
  const words = text.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length + 1 > budget) break;
    out = next;
  }
  return `${(out || text.slice(0, Math.max(3, budget - 1))).replace(/[,\s]+$/, "")}…`;
}

function shortenName(name: string, budget: number): string {
  if (name.length <= budget) return name;
  const trimParty = (party: string) => party.replace(/,?\s+et al\.?$/i, "").split(/,\s+/)[0]?.trim() || party;
  const abbreviate = (party: string) => T6.reduce((value, [pattern, short]) => value.replace(pattern, short), party);
  const parts = /^(.+?)\s+v\.\s+(.+)$/.exec(name);
  if (!parts?.[1] || !parts[2]) {
    const short = abbreviate(name);
    return truncateWords(short, budget);
  }
  let first = trimParty(parts[1]);
  let second = trimParty(parts[2]);
  if (`${first} v. ${second}`.length <= budget) return `${first} v. ${second}`;
  first = abbreviate(first);
  second = abbreviate(second);
  if (`${first} v. ${second}`.length <= budget) return `${first} v. ${second}`;
  const room = budget - 4;
  const firstBudget = Math.max(Math.ceil(room * 0.6), room - second.length);
  const firstShort = truncateWords(first, firstBudget);
  return `${firstShort} v. ${truncateWords(second, Math.max(8, room - firstShort.length))}`;
}

/** ", No. docket (Court Year)" — the part of the title after the case name. */
export function caseCitationSuffix(input: Omit<CaseTitleInput, "caption">): string {
  const court = courtAbbreviation(input.courtName, input.providerCourtId);
  const parenthetical = [court, year({ ...input, caption: "" })].filter(Boolean).join(" ");
  return `, No. ${input.docketNumber.trim()}${parenthetical ? ` (${parenthetical})` : ""}`;
}

/** "Case name, No. docket (Court Year)", shortening the case name before ever dropping the court. */
export function buildCaseTitle(input: CaseTitleInput, target = CASE_TITLE_TARGET_LENGTH): string {
  const name = input.caption.replace(/\s+/g, " ").trim();
  const tail = caseCitationSuffix(input);
  const full = `${name}${tail}`;
  if (full.length <= target) return full;
  return `${shortenName(name, Math.max(32, target - tail.length))}${tail}`;
}
