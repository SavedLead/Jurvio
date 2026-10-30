/**
 * Authoritative registry of federal courts, keyed by CourtListener court id
 * (`court.provider_court_id`). This is the single source of truth for which courts the
 * ingestion/publication pipeline treats as VERIFIED federal courts.
 *
 * Why this exists: the bulk court loader records every provider court as `not_verified`
 * and never promotes it, so authentic federal courts (district courts, historical circuit
 * courts, the Tax Court, etc.) sat permanently unverified and blocked publication. The fix
 * is NOT to trust the provider's label -- it is to verify court identity against an
 * EXPLICIT, authoritative allowlist. Only ids present in this registry are verified;
 * every other court id -- including other federal-code ids such as executive-branch
 * administrative tribunals, state courts mislabeled federal, and ids we have not yet
 * classified -- stays `not_verified`.
 *
 * Scope (approved): current federal courts, specialized federal courts, and
 * historical/predecessor federal courts, each labeled with its court class, constitutional
 * article, status, and (where a predecessor) its verified successor. The id groups below
 * were derived from the CourtListener court universe (read-only diagnostic) and
 * cross-classified against authoritative federal court records.
 *
 * Deliberately EXCLUDED (kept `not_verified`): the U.S. Supreme Court (its own dedicated
 * pipeline owns it and the federal opinion publishers exclude it), executive-branch
 * administrative tribunals and offices (MSPB, BIA, PTAB/TTAB, boards of contract appeals,
 * Attorney-General opinions, etc. -- not Article I/III courts), and state or ambiguous
 * entries. Two federal-code ids remain genuinely ambiguous and are listed for review, not
 * verified: `ctappindterr` (Court of Appeals of Indian Territory) and `superctsdfla`.
 */

export type FederalCourtCategory = "current" | "historical";
export type FederalCourtClass =
  | "court_of_appeals"
  | "district"
  | "bankruptcy"
  | "bankruptcy_appellate_panel"
  | "specialized"
  | "circuit_court";
/** Constitutional basis: III (Art. III), I (legislative/Art. I), IV (territorial). */
export type FederalCourtArticle = "I" | "III" | "IV";
export type FederalCourtStatus = "active" | "abolished";

export interface FederalCourtEntry {
  /** CourtListener court id (the authoritative registry key). */
  id: string;
  category: FederalCourtCategory;
  courtClass: FederalCourtClass;
  article: FederalCourtArticle;
  status: FederalCourtStatus;
  /** Authoritative name, carried for specialized/historical courts where precision matters. */
  name?: string;
  /** Verified successor court id, for a predecessor court (e.g. bta -> tax). */
  supersededBy?: string;
  note?: string;
}

// --- Current Article III courts ---------------------------------------------------------
const CURRENT_COURTS_OF_APPEALS: readonly string[] = [
  "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc",
];

const CURRENT_DISTRICT_COURTS_ARTICLE_III: readonly string[] = [
  "akd", "almd", "alnd", "alsd", "ared", "arwd", "azd", "cacd",
  "caed", "cand", "casd", "cod", "ctd", "dcd", "ded", "flmd",
  "flnd", "flsd", "gamd", "gand", "gasd", "hid", "iand", "iasd",
  "idd", "ilcd", "ilnd", "ilsd", "innd", "insd", "ksd", "kyed",
  "kywd", "laed", "lamd", "lawd", "mad", "mdd", "med", "mied",
  "miwd", "mnd", "moed", "mowd", "msnd", "mssd", "mtd", "nced",
  "ncmd", "ncwd", "ndd", "ned", "nhd", "njd", "nmd", "nvd",
  "nyed", "nynd", "nysd", "nywd", "ohnd", "ohsd", "oked", "oknd",
  "okwd", "ord", "paed", "pamd", "pawd", "prd", "rid", "scd",
  "sdd", "tned", "tnmd", "tnwd", "txed", "txnd", "txsd", "txwd",
  "utd", "vaed", "vawd", "vtd", "waed", "wawd", "wied", "wiwd",
  "wvnd", "wvsd", "wyd",
];

// Article IV territorial U.S. district courts (current, in scope, not Article III).
const CURRENT_TERRITORIAL_DISTRICT_COURTS: readonly string[] = ["gud", "nmid", "vid"];

// Current U.S. bankruptcy courts (Article I units of the district courts).
const CURRENT_BANKRUPTCY_COURTS: readonly string[] = [
  "akb", "almb", "alnb", "alsb", "arb", "areb", "arwb", "cacb",
  "caeb", "canb", "casb", "cob", "ctb", "dcb", "deb", "flmb",
  "flnb", "flsb", "gamb", "ganb", "gasb", "gub", "hib", "ianb",
  "iasb", "idb", "ilcb", "ilnb", "ilsb", "innb", "insb", "ksb",
  "kyeb", "kywb", "laeb", "lamb", "lawb", "mab", "mdb", "meb",
  "mieb", "miwb", "mnb", "moeb", "mowb", "msnb", "mssb", "mtb",
  "nceb", "ncmb", "ncwb", "ndb", "nebraskab", "nhb", "njb", "nmb",
  "nmib", "nvb", "nyeb", "nynb", "nysb", "nywb", "ohnb", "ohsb",
  "okeb", "oknb", "okwb", "orb", "paeb", "pamb", "pawb", "prb",
  "rib", "scb", "sdb", "tennesseeb", "tneb", "tnmb", "tnwb", "txeb",
  "txnb", "txsb", "txwb", "utb", "vaeb", "vawb", "vib", "vtb",
  "waeb", "wawb", "wieb", "wiwb", "wvnb", "wvsb", "wyb",
];

const CURRENT_BANKRUPTCY_APPELLATE_PANELS: readonly string[] = [
  "bap1", "bap2", "bap6", "bap8", "bap9", "bap10", "bapma", "bapme",
];

// Current specialized federal courts (genuine Article I/III courts, not executive boards).
const CURRENT_SPECIALIZED: Readonly<Record<string, { name: string; article: FederalCourtArticle }>> = {
  tax:   { name: "United States Tax Court", article: "I" },
  uscfc: { name: "United States Court of Federal Claims", article: "I" },
  cit:   { name: "United States Court of International Trade", article: "III" },
  cavc:  { name: "United States Court of Appeals for Veterans Claims", article: "I" },
  jpml:  { name: "United States Judicial Panel on Multidistrict Litigation", article: "III" },
  fisc:  { name: "United States Foreign Intelligence Surveillance Court", article: "III" },
  fiscr: { name: "United States Foreign Intelligence Surveillance Court of Review", article: "III" },
};

// --- Historical / predecessor federal courts --------------------------------------------
// U.S. Circuit Courts (trial/intermediate), abolished by the Judicial Code of 1911.
const HISTORICAL_CIRCUIT_COURTS: readonly string[] = [
  "circtcapefearnc", "circtdal", "circtdalb", "circtdalbanyny", "circtdar", "circtdca", "circtdco", "circtdct",
  "circtddc", "circtdedenton", "circtdel", "circtdga", "circtdia", "circtdid", "circtdil", "circtdin",
  "circtdks", "circtdky", "circtdla", "circtdma", "circtdmd", "circtdme", "circtdmi", "circtdmn",
  "circtdmo", "circtdms", "circtdmt", "circtdnd", "circtdne", "circtdnewbern", "circtdnh", "circtdnj",
  "circtdnv", "circtdoh", "circtdor", "circtdpa", "circtdpamptico", "circtdri", "circtdsc", "circtdsd",
  "circtdterrar", "circtdtx", "circtdut", "circtdva", "circtdvt", "circtdwa", "circtdwi", "circtdwilm",
  "circtdwv", "circtdwy", "circtedar", "circtedil", "circtedky", "circtedla", "circtedmi", "circtedmo",
  "circtednc", "circtedny", "circtedok", "circtedpa", "circtedsc", "circtedtn", "circtedtx", "circtedva",
  "circtedwa", "circtedwi", "circtmdal", "circtmdpa", "circtmdtn", "circtmissterr", "circtnc", "circtndal",
  "circtndca", "circtndfl", "circtndga", "circtndil", "circtndms", "circtndny", "circtndoh", "circtndtx",
  "circtndwv", "circtnia", "circtny", "circtsdal", "circtsdca", "circtsdfl", "circtsdga", "circtsdia",
  "circtsdil", "circtsdms", "circtsdny", "circtsdoh", "circtsdtex", "circtsdwv", "circttenn", "circtwdar",
  "circtwdky", "circtwdla", "circtwdmi", "circtwdmo", "circtwdnc", "circtwdny", "circtwdok", "circtwdpa",
  "circtwdtex", "circtwdtn", "circtwdva", "circtwdwa", "circtwdwi", "uscirct",
];

// Original/consolidated U.S. district courts later divided into the modern districts.
const HISTORICAL_DISTRICT_COURTS: readonly string[] = [
  "ald", "ard", "californiad", "canalzoned", "fld", "gad", "iad", "illinoisd",
  "illinoised", "indianad", "kyd", "lad", "michd", "missd", "mod", "ncd",
  "nyd", "ohiod", "okd", "orld", "pennsylvaniad", "southcarolinaed", "southcarolinawd", "tennessed",
  "texd", "usdistct", "vad", "washd", "wisd", "wvad",
];

interface HistoricalSpecializedEntry {
  name: string;
  article: FederalCourtArticle;
  supersededBy?: string;
  note: string;
}
const HISTORICAL_SPECIALIZED: Readonly<Record<string, HistoricalSpecializedEntry>> = {
  bta:  { name: "United States Board of Tax Appeals", article: "I", supersededBy: "tax", note: "Renamed the United States Tax Court (1942)." },
  cusc: { name: "United States Customs Court", article: "III", supersededBy: "cit", note: "Reconstituted as the United States Court of International Trade (1980)." },
  ccpa: { name: "United States Court of Customs and Patent Appeals", article: "III", supersededBy: "cafc", note: "Merged into the Court of Appeals for the Federal Circuit (1982)." },
  cc:   { name: "United States Court of Claims", article: "III", supersededBy: "cafc", note: "Split into the Court of Federal Claims and the Federal Circuit (1982)." },
  com:  { name: "Commerce Court of the United States", article: "III", note: "Abolished (1913); jurisdiction returned to the circuit courts." },
  eca:  { name: "Emergency Court of Appeals", article: "III", note: "Wartime/postwar price-control appellate court; abolished (1962)." },
  tecoa:{ name: "Temporary Emergency Court of Appeals", article: "III", note: "Energy price-control appellate court; abolished (1993)." },
  reglrailreorgct: { name: "Special Court under the Regional Rail Reorganization Act", article: "III", note: "Abolished (1997)." },
  usberlinct: { name: "United States Court of Berlin", article: "I", note: "Occupation-era court (1955-1979)." },
  usprovctla: { name: "United States Provisional Court for the State of Louisiana", article: "I", note: "Civil-War-era provisional court (1862-1865)." },
};

/**
 * Federal-code court ids we deliberately do NOT verify, with the reason. Documented in code
 * so the "no blanket verification on the provider label" decision is explicit and testable.
 */
export type ExclusionReason =
  | "supreme_court_separate_pipeline"
  | "administrative_tribunal"
  | "state_or_mismatched"
  | "ambiguous_pending_review";
export const EXCLUDED_FEDERAL_COURTS: Readonly<Record<string, ExclusionReason>> = {
  scotus: "supreme_court_separate_pipeline",
  // Executive-branch administrative tribunals / offices -- not Article I/III courts.
  ag: "administrative_tribunal", asbca: "administrative_tribunal", bia: "administrative_tribunal",
  bpai: "administrative_tribunal", bva: "administrative_tribunal", deptinterior: "administrative_tribunal",
  mspb: "administrative_tribunal", olc: "administrative_tribunal", padeptjust: "administrative_tribunal",
  philadeptjust: "administrative_tribunal", ptab: "administrative_tribunal", ttab: "administrative_tribunal",
  usjudconfcomdis: "administrative_tribunal", uslandoffice: "administrative_tribunal", ussurveyor: "administrative_tribunal",
  judcoun: "administrative_tribunal", judcoun2: "administrative_tribunal", judcoun3: "administrative_tribunal",
  judcoun5: "administrative_tribunal", judcoun6: "administrative_tribunal", judcoun7: "administrative_tribunal",
  judcoun8: "administrative_tribunal", judcoun9: "administrative_tribunal", judcoun10: "administrative_tribunal",
  judcoundc: "administrative_tribunal",
  // State or ambiguous entries mislabeled with a federal jurisdiction code.
  alactapp: "state_or_mismatched", caca: "state_or_mismatched", indcirct: "state_or_mismatched",
  // Genuinely ambiguous federal-code ids: left unverified, flagged for review.
  ctappindterr: "ambiguous_pending_review", superctsdfla: "ambiguous_pending_review",
};

function buildRegistry(): Map<string, FederalCourtEntry> {
  const registry = new Map<string, FederalCourtEntry>();
  const add = (entry: FederalCourtEntry) => {
    if (registry.has(entry.id)) throw new Error(`Duplicate federal court registry id: ${entry.id}`);
    if (EXCLUDED_FEDERAL_COURTS[entry.id]) {
      throw new Error(`Federal court id ${entry.id} is both registered and excluded`);
    }
    registry.set(entry.id, entry);
  };
  for (const id of CURRENT_COURTS_OF_APPEALS) add({ id, category: "current", courtClass: "court_of_appeals", article: "III", status: "active" });
  for (const id of CURRENT_DISTRICT_COURTS_ARTICLE_III) add({ id, category: "current", courtClass: "district", article: "III", status: "active" });
  for (const id of CURRENT_TERRITORIAL_DISTRICT_COURTS) add({ id, category: "current", courtClass: "district", article: "IV", status: "active", note: "Territorial U.S. district court (Article IV)." });
  for (const id of CURRENT_BANKRUPTCY_COURTS) add({ id, category: "current", courtClass: "bankruptcy", article: "I", status: "active" });
  for (const id of CURRENT_BANKRUPTCY_APPELLATE_PANELS) add({ id, category: "current", courtClass: "bankruptcy_appellate_panel", article: "I", status: "active" });
  for (const [id, s] of Object.entries(CURRENT_SPECIALIZED)) add({ id, category: "current", courtClass: "specialized", article: s.article, status: "active", name: s.name });
  for (const id of HISTORICAL_CIRCUIT_COURTS) add({ id, category: "historical", courtClass: "circuit_court", article: "III", status: "abolished", note: "U.S. Circuit Court; abolished by the Judicial Code of 1911." });
  for (const id of HISTORICAL_DISTRICT_COURTS) add({ id, category: "historical", courtClass: "district", article: "III", status: "abolished", note: "Original/consolidated U.S. district later divided into the modern districts." });
  for (const [id, h] of Object.entries(HISTORICAL_SPECIALIZED)) add({ id, category: "historical", courtClass: "specialized", article: h.article, status: "abolished", name: h.name, supersededBy: h.supersededBy, note: h.note });
  return registry;
}

const FEDERAL_COURT_REGISTRY: ReadonlyMap<string, FederalCourtEntry> = buildRegistry();

/** All verified federal court ids, sorted. Useful for diagnostics and eligibility queries. */
export const FEDERAL_COURT_REGISTRY_IDS: readonly string[] = Object.freeze(
  [...FEDERAL_COURT_REGISTRY.keys()].sort(),
);

/** The registry entry for a CourtListener court id, or null if it is not a verified court. */
export function getFederalCourtEntry(id: string | null | undefined): FederalCourtEntry | null {
  if (!id) return null;
  return FEDERAL_COURT_REGISTRY.get(id.trim()) ?? null;
}

/** True iff `id` is an explicitly registered (authoritative) verified federal court. */
export function isRegisteredFederalCourt(id: string | null | undefined): boolean {
  return getFederalCourtEntry(id) !== null;
}

/**
 * The verification state the court loader should record for a CourtListener court id:
 * `verified` only for ids on the authoritative registry, `not_verified` for everything
 * else (unknown ids, administrative tribunals, state/mismatched/ambiguous entries). Never
 * verifies on the provider label alone.
 */
export function federalCourtRegistrationVerification(
  id: string | null | undefined,
): "verified" | "not_verified" {
  return isRegisteredFederalCourt(id) ? "verified" : "not_verified";
}
