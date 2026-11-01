/**
 * The 94 U.S. district courts by CourtListener id, with the names and
 * Bluebook abbreviations official documents use for them. Used to read a
 * court only where a document states it ("U.S. District Court for the
 * District of South Carolina", "(D.S.C. filed Oct. 29, 2026)").
 */
const STATES: Record<string, [string, string]> = {
  al: ["Alabama", "Ala."], ak: ["Alaska", "Alaska"], az: ["Arizona", "Ariz."], ar: ["Arkansas", "Ark."],
  ca: ["California", "Cal."], co: ["Colorado", "Colo."], ct: ["Connecticut", "Conn."], de: ["Delaware", "Del."],
  dc: ["Columbia", "D.C."], fl: ["Florida", "Fla."], ga: ["Georgia", "Ga."], hi: ["Hawaii", "Haw."],
  id: ["Idaho", "Idaho"], il: ["Illinois", "Ill."], in: ["Indiana", "Ind."], ia: ["Iowa", "Iowa"],
  ks: ["Kansas", "Kan."], ky: ["Kentucky", "Ky."], la: ["Louisiana", "La."], me: ["Maine", "Me."],
  md: ["Maryland", "Md."], ma: ["Massachusetts", "Mass."], mi: ["Michigan", "Mich."], mn: ["Minnesota", "Minn."],
  ms: ["Mississippi", "Miss."], mo: ["Missouri", "Mo."], mt: ["Montana", "Mont."], ne: ["Nebraska", "Neb."],
  nv: ["Nevada", "Nev."], nh: ["New Hampshire", "N.H."], nj: ["New Jersey", "N.J."], nm: ["New Mexico", "N.M."],
  ny: ["New York", "N.Y."], nc: ["North Carolina", "N.C."], nd: ["North Dakota", "N.D."], oh: ["Ohio", "Ohio"],
  ok: ["Oklahoma", "Okla."], or: ["Oregon", "Or."], pa: ["Pennsylvania", "Pa."], ri: ["Rhode Island", "R.I."],
  sc: ["South Carolina", "S.C."], sd: ["South Dakota", "S.D."], tn: ["Tennessee", "Tenn."], tx: ["Texas", "Tex."],
  ut: ["Utah", "Utah"], vt: ["Vermont", "Vt."], va: ["Virginia", "Va."], wa: ["Washington", "Wash."],
  wv: ["West Virginia", "W. Va."], wi: ["Wisconsin", "Wis."], wy: ["Wyoming", "Wyo."], gu: ["Guam", "Guam"],
  pr: ["Puerto Rico", "P.R."], vi: ["Virgin Islands", "V.I."], nmi: ["Northern Mariana Islands", "N. Mar. I."],
};

const DIRECTION: Record<string, [string, string]> = {
  n: ["Northern", "N.D."], s: ["Southern", "S.D."], e: ["Eastern", "E.D."], w: ["Western", "W.D."],
  m: ["Middle", "M.D."], c: ["Central", "C.D."],
};

export const DISTRICT_COURT_CODES: readonly string[] = [
  "akd", "almd", "alnd", "alsd", "ared", "arwd", "azd", "cacd", "caed", "cand", "casd", "cod", "ctd", "dcd", "ded",
  "flmd", "flnd", "flsd", "gamd", "gand", "gasd", "gud", "hid", "iand", "iasd", "idd", "ilcd", "ilnd", "ilsd", "innd",
  "insd", "ksd", "kyed", "kywd", "laed", "lamd", "lawd", "mad", "mdd", "med", "mied", "miwd", "mnd", "moed", "mowd",
  "msnd", "mssd", "mtd", "nced", "ncmd", "ncwd", "ndd", "ned", "nhd", "njd", "nmd", "nmid", "nvd", "nyed", "nynd",
  "nysd", "nywd", "ohnd", "ohsd", "oked", "oknd", "okwd", "ord", "paed", "pamd", "pawd", "prd", "rid", "scd", "sdd",
  "tned", "tnmd", "tnwd", "txed", "txnd", "txsd", "txwd", "utd", "vaed", "vawd", "vid", "vtd", "waed", "wawd", "wied",
  "wiwd", "wvnd", "wvsd", "wyd",
];

export interface DistrictCourt { code: string; name: string; abbreviation: string; stateName: string; direction: string | null }

function describe(code: string): DistrictCourt {
  if (code === "nmid") return { code, name: "District of the Northern Mariana Islands", abbreviation: "D.N. Mar. I.", stateName: "Northern Mariana Islands", direction: null };
  if (code === "dcd") return { code, name: "District of Columbia", abbreviation: "D.D.C.", stateName: "District of Columbia", direction: null };
  const match = /^([a-z]{2})([nsewmc]?)d$/.exec(code);
  if (!match) throw new Error(`not a district code: ${code}`);
  const [state, stateAbbr] = STATES[match[1]!]!;
  const direction = match[2] ? DIRECTION[match[2]]! : null;
  const prefix = direction ? direction[1] : "D.";
  const abbreviation = /^([A-Z]\.)+$/.test(stateAbbr) ? `${prefix}${stateAbbr}` : `${prefix} ${stateAbbr}`;
  const article = code === "vid" ? "the " : "";
  return { code, name: `${direction ? `${direction[0]} ` : ""}District of ${article}${state}`, abbreviation, stateName: state, direction: direction?.[0] ?? null };
}

export const DISTRICT_COURTS: ReadonlyMap<string, DistrictCourt> = new Map(DISTRICT_COURT_CODES.map((code) => [code, describe(code)]));

export function districtCourt(code: string): DistrictCourt | null {
  return DISTRICT_COURTS.get(code.toLowerCase()) ?? null;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Northern District of Ohio", "District of the Virgin Islands" → code. */
const NAME_TO_CODE = new Map<string, string>();
const ABBR_TO_CODE = new Map<string, string>();
for (const court of DISTRICT_COURTS.values()) {
  NAME_TO_CODE.set(court.name.toLowerCase(), court.code);
  ABBR_TO_CODE.set(court.abbreviation.replace(/\s+/g, "").toLowerCase(), court.code);
}
NAME_TO_CODE.set("district of the district of columbia", "dcd");
NAME_TO_CODE.set("district of virgin islands", "vid");

const NAME_PATTERN = new RegExp(
  String.raw`\b(?:(Northern|Southern|Eastern|Western|Middle|Central)\s+)?District\s+of\s+(?:the\s+)?(` +
  [...new Set(Object.values(STATES).map(([name]) => name))].sort((a, b) => b.length - a.length).map(escape).join("|") +
  String.raw`)\b(?!\s+Circuit)`,
  "gi",
);

// Spaced or closed-up Bluebook forms: "S.D.N.Y.", "S.D. N.Y.", "E.D. Cal.", "D. Mass.", "D.D.C.".
const ABBR_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z.])(` +
  [...DISTRICT_COURTS.values()].map((court) => court.abbreviation)
    .sort((a, b) => b.length - a.length)
    .map((abbr) => escape(abbr).replace(/(\\\.)(?=[A-Z])/g, "$1\\s?").replace(/\\ /g, "\\s?").replace(/ /g, "\\s?"))
    .join("|") +
  String.raw`)(?![A-Za-z])`,
  "g",
);

export interface CourtMention { code: string; index: number; text: string; form: "name" | "abbreviation" }

/** Every district court a text states, by full name or Bluebook abbreviation, in order. */
export function findCourtMentions(text: string): CourtMention[] {
  const mentions: CourtMention[] = [];
  for (const match of text.matchAll(NAME_PATTERN)) {
    const direction = match[1] ? `${match[1][0]!.toUpperCase()}${match[1].slice(1).toLowerCase()} ` : "";
    const stateName = match[2]!.replace(/\s+/g, " ");
    const canonical = Object.values(STATES).find(([name]) => name.toLowerCase() === stateName.toLowerCase())?.[0] ?? stateName;
    const key = canonical === "Columbia"
      ? "district of columbia"
      : `${direction}district of ${canonical === "Virgin Islands" ? "the " : ""}${canonical}`.toLowerCase();
    const code = NAME_TO_CODE.get(key);
    // "District of California" names no court (California has four): ignore it. "the District of
    // Columbia" is also a jurisdiction (multistate coalitions list it with the states), so it counts
    // as the court only right after "court ... for the" or "U.S. Attorney for the".
    if (code === "dcd" && !/(?:court|attorney|attorney's office)[^.]{0,40}\bfor\s+the\s*$/i.test(text.slice(Math.max(0, (match.index ?? 0) - 80), match.index))) continue;
    if (code) mentions.push({ code, index: match.index ?? 0, text: match[0], form: "name" });
  }
  for (const match of text.matchAll(ABBR_PATTERN)) {
    const code = ABBR_TO_CODE.get(match[1]!.replace(/\s+/g, "").toLowerCase());
    if (code) mentions.push({ code, index: match.index ?? 0, text: match[0], form: "abbreviation" });
  }
  return mentions.sort((a, b) => a.index - b.index);
}

/** A structured "Federal Court" field: exactly one district, or null. */
export function courtFromField(value: string | null | undefined): string | null {
  if (!value) return null;
  const codes = new Set(findCourtMentions(value).map((mention) => mention.code));
  return codes.size === 1 ? [...codes][0]! : null;
}
