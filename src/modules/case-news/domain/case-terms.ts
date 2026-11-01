// Turns a case caption, docket and court into the terms used to find and
// verify news coverage. Pure and deterministic so the matcher can be tested.

export type PartyKind = "organization" | "agency" | "government" | "person" | "unknown";

export interface PartyTerm {
  /** The caption side as filed, cleaned. */
  raw: string;
  /** Word news headlines use for this party ("Uber Technologies", "Seattle", "Smith"); null when not searchable. */
  key: string | null;
  /** Single headline word for multi-word organizations ("Harvard"); null otherwise. */
  anchor?: string | null;
  /** Distinctiveness when only the anchor word appears (lower when the rest of the name carried meaning). */
  anchorDistinctiveness?: number;
  /** Alternative headline words for the same party (e.g. "Justice Department" for USA). Used only to verify titles. */
  aliases: string[];
  kind: PartyKind;
  /** 0..1, how much a headline mention identifies this party. */
  distinctiveness: number;
}

export interface CaseNewsTerms {
  left: PartyTerm;
  right: PartyTerm | null;
  /** "Uber Technologies v. Seattle" style short name, when both keys exist. */
  shortName: string | null;
  courtTerms: string[];
  docketPatterns: RegExp[];
  /** Docket is distinctive enough to match on its own (district style "1:24-cv-01234"). */
  docketDistinctive: boolean;
}

const ORG_SUFFIX = /[,\s]+(?:INC|INCORPORATED|LLC|L\.L\.C|LLP|L\.P|LP|LTD|LIMITED|CORP|CORPORATION|CO|COMPANY|N\.A|PLC|P\.C|PLLC|S\.A|AG|GMBH|HOLDINGS?|GROUP)\.?$/i;
const ORG_WORDS = /\b(?:INC|LLC|CORP|CORPORATION|COMPANY|BANK|BANCORP|UNION|ASSOCIATION|ASS'N|UNIVERSITY|COLLEGE|CENTER|FOUNDATION|COUNCIL|TRUST|GROUP|HOLDINGS|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|INDUSTRIES|PARTNERS|CAPITAL|INSURANCE|PHARMACEUTICALS?|LABORATORIES|LABS|ENTERPRISES|INTERNATIONAL|NETWORK|MEDIA|AIRLINES|MOTORS|ENERGY|HOSPITAL|HEALTH|CHURCH|COALITION|INSTITUTE|PLATFORMS|LTD|PLC|LP|LLP|N\.A)\b/i;
const AGENCY = /\b(?:COMMISSION|DEPARTMENT|DEP'T|BUREAU|AGENCY|ADMINISTRATION|BOARD|SERVICE|OFFICE|AUTHORITY|SECRETARY|COMMISSIONER|ATTORNEY GENERAL|DIRECTOR)\b/i;
const UNITED_STATES = /^(?:THE\s+)?(?:USA|U\.S\.A\.?|U\.S\.|UNITED STATES(?: OF AMERICA)?)$/i;
const STATE_LIKE = /^(?:THE\s+)?(?:PEOPLE OF THE STATE OF|PEOPLE OF|STATE OF|COMMONWEALTH OF|CITY OF|COUNTY OF|CITY AND COUNTY OF|TOWN OF|VILLAGE OF|DISTRICT OF|TERRITORY OF)\s+(.+)$/i;
const COUNTY_SUFFIX = /^(.+?)\s+(?:COUNTY|PARISH|CITY|TOWNSHIP)$/i;
const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
  "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming", "columbia", "puerto rico",
]);
// Too common in headlines to identify a party on their own.
const GENERIC_KEYS = new Set([
  "doe", "does", "john doe", "jane doe", "unknown", "sealed", "in re", "people", "state", "united", "america", "national",
  "american", "federal", "first", "new", "president", "government", "company", "city", "county", "board",
  "school", "district", "union", "bank", "national association",
]);
// Officials sued in their official capacity in hundreds of cases at once.
const SERIAL_OFFICIAL_SURNAMES = new Set(["trump", "biden", "bondi", "garland", "rubio", "noem", "hegseth", "bessent",
  "lutnick", "mayorkas", "blinken", "bonta", "newsom", "abbott", "desantis", "hochul", "paxton", "becerra", "vought",
  "mcmahon", "duffy", "burgum", "zeldin", "chavez-deremer", "lyons", "musk"]);
// Words that do not identify an organization on their own.
const ORG_FILLER = new Set(["the", "of", "and", "for", "in", "on", "at", "a", "an", "president", "fellows", "board",
  "trustees", "regents", "center", "national", "american", "united", "states", "association", "council", "union",
  "company", "corporation", "group", "holdings", "international", "inc", "llc", "corp", "foundation", "institute",
  "coalition", "committee", "partners", "capital", "technologies", "systems", "services", "bank", "trust", "new",
  "first", "general", "global", "north", "south", "east", "west", "city", "county", "state", "university", "college",
  "health", "medical", "insurance", "federal", "public", "community", "citizens", "people", "alliance", "workers",
  "local", "chapter", "society", "network", "media", "energy", "industries", "enterprises", "home", "homes"]);

/** The word a headline would most likely use for an organization: "Harvard", "Uber". */
export function anchorToken(name: string): string | null {
  const words = name.split(/[\s,/&-]+/).map((word) => word.replace(/[^A-Za-z0-9'’.]/g, "").replace(/\.$/, ""));
  for (const word of words) {
    if (word.length < 3) continue;
    if (ORG_FILLER.has(word.toLowerCase())) continue;
    if (US_STATES.has(word.toLowerCase())) continue;
    return word;
  }
  return null;
}
// Most frequent U.S. surnames (Census 2010). A lone common surname in a headline is weak evidence.
const COMMON_SURNAMES = new Set(`smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez
gonzalez wilson anderson thomas taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis
robinson walker young allen king wright scott torres nguyen hill flores green adams nelson baker hall rivera campbell
mitchell carter roberts gomez phillips evans turner diaz parker cruz edwards collins reyes stewart morris morales murphy
cook rogers gutierrez ortiz morgan cooper peterson bailey reed kelly howard ramos kim cox ward richardson watson brooks
chavez wood james bennett gray mendoza ruiz hughes price alvarez castillo sanders patel myers long ross foster jimenez
powell jenkins perry russell sullivan bell coleman butler henderson barnes gonzales fisher vasquez simmons romero jordan
patterson alexander hamilton graham reynolds griffin wallace moreno west cole hayes bryant herrera gibson ellis tran
medina aguilar stevens murray ford castro marshall owens harrison fernandez mcdonald woods washington kennedy wells
vargas henry chen freeman webb tucker guzman burns crawford olson simpson porter hunter gordon mendez silva shaw snyder
mason dixon munoz hunt hicks holmes palmer wagner black robertson boyd rose stone salazar fox warren mills meyer rice
schmidt garza daniels ferguson nichols stephens soto weaver ryan gardner payne grant dunn kelley spencer hawkins arnold
pierce vazquez hansen peters santos hart bradley knight elliott cunningham duncan armstrong hudson carroll lane riley
andrews alvarado ray delgado berry perkins hoffman johnston matthews pena richards contreras willis carpenter lawrence
sandoval`.split(/\s+/).filter(Boolean));

const CIRCUIT_ORDINALS: Record<string, [string, string]> = {
  ca1: ["First Circuit", "1st Circuit"], ca2: ["Second Circuit", "2nd Circuit"], ca3: ["Third Circuit", "3rd Circuit"],
  ca4: ["Fourth Circuit", "4th Circuit"], ca5: ["Fifth Circuit", "5th Circuit"], ca6: ["Sixth Circuit", "6th Circuit"],
  ca7: ["Seventh Circuit", "7th Circuit"], ca8: ["Eighth Circuit", "8th Circuit"], ca9: ["Ninth Circuit", "9th Circuit"],
  ca10: ["Tenth Circuit", "10th Circuit"], ca11: ["Eleventh Circuit", "11th Circuit"],
};

export type CourtFamily = "scotus" | "appeals" | "district" | "other";

export function courtFamily(courtCode: string | null | undefined): CourtFamily {
  const code = (courtCode ?? "").toLowerCase();
  if (code === "scotus") return "scotus";
  if (/^ca\d{1,2}$/.test(code) || code === "cadc" || code === "cafc") return "appeals";
  if (/^[a-z]{2,4}d$/.test(code) || /^(?:dcd|nmid|gud|vid)$/.test(code)) return "district";
  return "other";
}

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s\-/'(])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
    .replace(/\b(Of|And|The|For|In|On|At|To|De|Del|La)\b/g, (word, _m, offset: number) => (offset === 0 ? word : word.toLowerCase()))
    .replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`);
}

/** Court names a news article would use for this court. */
export function courtTermsFor(courtCode: string | null | undefined, courtName: string | null | undefined): string[] {
  const code = (courtCode ?? "").toLowerCase();
  if (code === "scotus") return ["Supreme Court"];
  if (CIRCUIT_ORDINALS[code]) return [...CIRCUIT_ORDINALS[code]];
  if (code === "cadc") return ["D.C. Circuit"];
  if (code === "cafc") return ["Federal Circuit"];
  const name = courtName ?? "";
  const district = name.match(/\b((?:Northern|Southern|Eastern|Western|Middle|Central)\s+)?District of ([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,2})/);
  if (district) return [`${district[1] ?? ""}District of ${district[2]}`.trim()];
  return [];
}

function cleanSide(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/\s*,?\s*\bET\s+AL\.?/gi, "")
    .replace(/\s*\((?:[^)]*)\)\s*/g, " ")
    .replace(/\s*,?\s*\b(?:PETITIONERS?|RESPONDENTS?|APPELLANTS?|APPELLEES?|PLAINTIFFS?|DEFENDANTS?)(?:-[A-Z]+)?\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[,;.\s]+$/, "")
    .trim();
}

function stripOrgSuffix(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    const next = current.replace(ORG_SUFFIX, "").replace(/[,\s]+$/, "");
    if (next === current) break;
    current = next;
  }
  return current.replace(/^THE\s+/i, "");
}

export function describeParty(side: string): PartyTerm {
  const raw = cleanSide(side);
  const upper = raw.toUpperCase();
  if (!raw) return { raw, key: null, aliases: [], kind: "unknown", distinctiveness: 0 };
  if (UNITED_STATES.test(upper)) {
    return { raw, key: null, aliases: ["United States", "U.S.", "Justice Department", "DOJ", "prosecutors", "federal government"], kind: "government", distinctiveness: 0.3 };
  }
  const stateLike = upper.match(STATE_LIKE);
  if (stateLike?.[1]) {
    const place = titleCase(stripOrgSuffix(stateLike[1]!));
    const isState = US_STATES.has(place.toLowerCase());
    return { raw, key: place, aliases: [], kind: "government", distinctiveness: isState ? 0.2 : 0.3 };
  }
  if (US_STATES.has(upper.toLowerCase())) return { raw, key: titleCase(raw), aliases: [], kind: "government", distinctiveness: 0.2 };
  const county = upper.match(COUNTY_SUFFIX);
  if (county && !ORG_WORDS.test(upper)) {
    return { raw, key: titleCase(raw), aliases: [], kind: "government", distinctiveness: 0.4 };
  }
  if (AGENCY.test(upper) && !ORG_WORDS.test(upper.replace(/\bUNION\b/, ""))) {
    const agency = titleCase(stripOrgSuffix(raw.replace(/^(?:UNITED STATES|U\.S\.)\s+/i, "")));
    return { raw, key: agency.length >= 6 ? agency : null, aliases: [], kind: "agency", distinctiveness: 0.5 };
  }
  if (ORG_WORDS.test(upper) || ORG_SUFFIX.test(raw)) {
    const core = titleCase(stripOrgSuffix(raw));
    const generic = GENERIC_KEYS.has(core.toLowerCase()) || core.length < 3;
    if (generic) return { raw, key: null, aliases: [], kind: "organization", distinctiveness: 0 };
    const words = core.split(/\s+/);
    const anchor = words.length >= 2 ? anchorToken(core) : null;
    // "Uber Technologies" -> "Uber" carries the whole name; "Learning Resources" -> "Learning" does not.
    const rest = words.filter((word) => word.replace(/[^A-Za-z]/g, "").toLowerCase() !== anchor?.toLowerCase());
    const anchorDistinctiveness = anchor && rest.every((word) => ORG_FILLER.has(word.replace(/[^A-Za-z]/g, "").toLowerCase())) ? 1 : 0.6;
    return { raw, key: core, anchor, anchorDistinctiveness, aliases: [], kind: "organization", distinctiveness: words.length > 2 && !anchor ? 0.6 : 1 };
  }
  // Person or single-word name: news uses the surname.
  const tokens = raw.replace(/[.,]/g, " ").split(/\s+/).filter((token) => /^[A-Za-z'’-]{2,}$/.test(token)
    && !/^(?:JR|SR|II|III|IV|MD|ESQ)$/i.test(token));
  const surname = tokens.at(-1);
  if (!surname || surname.length < 3) return { raw, key: null, aliases: [], kind: "unknown", distinctiveness: 0 };
  const key = titleCase(surname);
  if (GENERIC_KEYS.has(key.toLowerCase())) return { raw, key: null, aliases: [], kind: "person", distinctiveness: 0 };
  if (SERIAL_OFFICIAL_SURNAMES.has(key.toLowerCase())) return { raw, key, aliases: [], kind: "person", distinctiveness: 0.3 };
  const common = COMMON_SURNAMES.has(key.toLowerCase());
  return { raw, key, aliases: [], kind: "person", distinctiveness: common ? 0.3 : 0.6 };
}

export function splitCaption(caption: string): [string, string | null] {
  const cleaned = caption.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.*?)\s+(?:v\.?|vs\.?|versus)\s+(.*)$/i);
  if (!match) return [cleaned, null];
  return [match[1]!, match[2]!];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patterns that find this docket in free text. "1:24-cv-01234-ABC" also
 * matches "24-cv-1234" and "1:24-cv-1234"; "23-719" matches only "No. 23-719" style.
 */
export function docketPatterns(docket: string): { patterns: RegExp[]; distinctive: boolean } {
  const value = docket.trim();
  const district = value.match(/^(?:\d+:)?(\d{2})-([a-z]{2,4})-0*(\d{1,6})/i);
  if (district) {
    const [, year, kind, number] = district;
    return {
      patterns: [new RegExp(`(?<![\\d-])(?:\\d+:)?${year}-${kind}-0*${number}(?!\\d)`, "i")],
      distinctive: true,
    };
  }
  const short = value.match(/^(\d{2,4})-(\d{1,6})$/);
  if (short) {
    const [, year, number] = short;
    return {
      patterns: [new RegExp(`\\bNos?\\.?\\s*${escapeRegExp(`${year}-`)}0*${number}(?![\\d-])`, "i")],
      distinctive: false,
    };
  }
  return { patterns: [], distinctive: false };
}

export function caseNewsTerms(input: { caption: string; docketNumber: string; courtCode: string | null; courtName: string | null }): CaseNewsTerms {
  const [leftRaw, rightRaw] = splitCaption(input.caption.replace(/^In re:?\s+/i, ""));
  const left = describeParty(leftRaw);
  const right = rightRaw ? describeParty(rightRaw) : null;
  const leftName = left.key ?? (left.kind === "government" && left.aliases.length ? "United States" : null);
  const rightName = right ? right.key ?? (right.kind === "government" && right.aliases.length ? "United States" : null) : null;
  const { patterns, distinctive } = docketPatterns(input.docketNumber);
  return {
    left,
    right,
    shortName: leftName && rightName ? `${leftName} v. ${rightName}` : null,
    courtTerms: courtTermsFor(input.courtCode, input.courtName),
    docketPatterns: patterns,
    docketDistinctive: distinctive,
  };
}

/**
 * Whether there is enough to search for this case without drowning in noise:
 * a distinctive docket, or two named sides where at least one is distinctive.
 */
export function searchable(terms: CaseNewsTerms): boolean {
  if (terms.courtTerms.length === 0) return false;
  if (!terms.right) return false;
  const sides = [terms.left, terms.right];
  const keyed = sides.filter((side) => side.key || side.aliases.length);
  if (keyed.length < 2) return false;
  return Math.max(...sides.map((side) => side.distinctiveness)) >= 0.6;
}
