/**
 * Which Supreme Court justice is allotted to each federal circuit (the "Circuit
 * Justice"), copied from the Court's current allotment order as published at
 * https://www.supremecourt.gov/about/circuitassignments.aspx ("It is ordered that
 * the following allotment be made ... pursuant to Title 28, United States Code,
 * Section 42 ... effective September 28, 2022"). Checked against that page on
 * 2026-11-02. When the Court issues a new allotment order (usually only when its
 * membership changes), update ALLOTMENT and ALLOTMENT_EFFECTIVE together.
 *
 * District and bankruptcy courts map to their circuit by the state or territory
 * the order lists for that circuit. Pure data; no I/O.
 */

export const ALLOTMENT_SOURCE_URL = "https://www.supremecourt.gov/about/circuitassignments.aspx";
export const ALLOTMENT_EFFECTIVE = "2022-09-28";
export const ALLOTMENT_CHECKED = "2026-11-02";
/** The Court's own guide: how an application reaches the Circuit Justice, and what they may do with it. */
export const APPLICATIONS_GUIDE_URL = "https://www.supremecourt.gov/publicinfo/reportersguide.pdf";

export type CircuitId = "ca1" | "ca2" | "ca3" | "ca4" | "ca5" | "ca6" | "ca7" | "ca8" | "ca9" | "ca10" | "ca11" | "cadc" | "cafc";

export interface CircuitJustice {
  circuit: CircuitId;
  circuitName: string;
  justiceName: string;
  title: "Chief Justice" | "Associate Justice";
  /** /justices/[slug] (see justice-slug.ts). */
  justiceSlug: string;
  /** States and territories the order lists for the circuit. */
  states: readonly string[];
}

const ROBERTS = { justiceName: "John G. Roberts, Jr.", title: "Chief Justice", justiceSlug: "john-glover-roberts-jr" } as const;
const JACKSON = { justiceName: "Ketanji Brown Jackson", title: "Associate Justice", justiceSlug: "ketanji-brown-jackson" } as const;
const SOTOMAYOR = { justiceName: "Sonia Sotomayor", title: "Associate Justice", justiceSlug: "sonia-sotomayor" } as const;
const ALITO = { justiceName: "Samuel A. Alito, Jr.", title: "Associate Justice", justiceSlug: "samuel-a-alito-jr" } as const;
const KAVANAUGH = { justiceName: "Brett M. Kavanaugh", title: "Associate Justice", justiceSlug: "brett-m-kavanaugh" } as const;
const BARRETT = { justiceName: "Amy Coney Barrett", title: "Associate Justice", justiceSlug: "amy-coney-barrett" } as const;
const KAGAN = { justiceName: "Elena Kagan", title: "Associate Justice", justiceSlug: "elena-kagan" } as const;
const GORSUCH = { justiceName: "Neil M. Gorsuch", title: "Associate Justice", justiceSlug: "neil-m-gorsuch" } as const;
const THOMAS = { justiceName: "Clarence Thomas", title: "Associate Justice", justiceSlug: "clarence-thomas" } as const;

/** The allotment order, circuit by circuit, as published (states in the order's own order). */
export const ALLOTMENT: readonly CircuitJustice[] = [
  { circuit: "cadc", circuitName: "District of Columbia Circuit", ...ROBERTS, states: ["District of Columbia"] },
  { circuit: "ca1", circuitName: "First Circuit", ...JACKSON, states: ["Maine", "Massachusetts", "New Hampshire", "Puerto Rico", "Rhode Island"] },
  { circuit: "ca2", circuitName: "Second Circuit", ...SOTOMAYOR, states: ["Connecticut", "New York", "Vermont"] },
  { circuit: "ca3", circuitName: "Third Circuit", ...ALITO, states: ["Delaware", "New Jersey", "Pennsylvania", "Virgin Islands"] },
  { circuit: "ca4", circuitName: "Fourth Circuit", ...ROBERTS, states: ["Maryland", "North Carolina", "South Carolina", "West Virginia", "Virginia"] },
  { circuit: "ca5", circuitName: "Fifth Circuit", ...ALITO, states: ["Louisiana", "Mississippi", "Texas"] },
  { circuit: "ca6", circuitName: "Sixth Circuit", ...KAVANAUGH, states: ["Kentucky", "Michigan", "Ohio", "Tennessee"] },
  { circuit: "ca7", circuitName: "Seventh Circuit", ...BARRETT, states: ["Illinois", "Indiana", "Wisconsin"] },
  { circuit: "ca8", circuitName: "Eighth Circuit", ...KAVANAUGH, states: ["Arkansas", "Iowa", "Minnesota", "Missouri", "Nebraska", "North Dakota", "South Dakota"] },
  { circuit: "ca9", circuitName: "Ninth Circuit", ...KAGAN, states: ["Alaska", "Arizona", "California", "Guam", "Hawaii", "Idaho", "Oregon", "Montana", "Nevada", "Northern Mariana Islands", "Washington"] },
  { circuit: "ca10", circuitName: "Tenth Circuit", ...GORSUCH, states: ["Colorado", "Kansas", "New Mexico", "Oklahoma", "Utah", "Wyoming"] },
  { circuit: "ca11", circuitName: "Eleventh Circuit", ...THOMAS, states: ["Alabama", "Florida", "Georgia"] },
  { circuit: "cafc", circuitName: "Federal Circuit", ...ROBERTS, states: [] },
];

/** CourtListener-style two-letter prefix of each district court id -> its circuit (from the states above). */
const PREFIX_CIRCUIT: Readonly<Record<string, CircuitId>> = {
  dc: "cadc",
  me: "ca1", ma: "ca1", nh: "ca1", pr: "ca1", ri: "ca1",
  ct: "ca2", ny: "ca2", vt: "ca2",
  de: "ca3", nj: "ca3", pa: "ca3", vi: "ca3",
  md: "ca4", nc: "ca4", sc: "ca4", wv: "ca4", va: "ca4",
  la: "ca5", ms: "ca5", tx: "ca5",
  ky: "ca6", mi: "ca6", oh: "ca6", tn: "ca6",
  il: "ca7", in: "ca7", wi: "ca7",
  ar: "ca8", ia: "ca8", mn: "ca8", mo: "ca8", ne: "ca8", nd: "ca8", sd: "ca8",
  ak: "ca9", az: "ca9", ca: "ca9", gu: "ca9", hi: "ca9", id: "ca9", or: "ca9", mt: "ca9", nv: "ca9", nmi: "ca9", wa: "ca9",
  co: "ca10", ks: "ca10", nm: "ca10", ok: "ca10", ut: "ca10", wy: "ca10",
  al: "ca11", fl: "ca11", ga: "ca11",
};

const BAP_CIRCUIT: Readonly<Record<string, CircuitId>> = {
  bap1: "ca1", bapma: "ca1", bapme: "ca1", bap2: "ca2", bap6: "ca6", bap8: "ca8", bap9: "ca9", bap10: "ca10",
};

/** The circuit a federal court sits in, from its court id ("ca7", "ilnd", "ilnb", "nmid", "bap9"); null when not a circuit/district/bankruptcy court. */
export function circuitOfCourt(courtId: string | null | undefined): CircuitId | null {
  const id = (courtId ?? "").trim().toLowerCase();
  if (!id) return null;
  if (ALLOTMENT.some((row) => row.circuit === id)) return id as CircuitId;
  if (BAP_CIRCUIT[id]) return BAP_CIRCUIT[id] ?? null;
  // Spelled-out bankruptcy ids CourtListener uses.
  if (id === "nebraskab") return "ca8";
  if (id === "tennesseeb") return "ca6";
  // Northern Mariana Islands: "nmid" (district) / "nmib" (bankruptcy); New Mexico is "nmd" / "nmb".
  if (id === "nmid" || id === "nmib") return "ca9";
  // District: state + (d | nd | sd | ed | wd | md | cd); bankruptcy: same with "b".
  const match = /^([a-z]{2})(?:[nsewmc]?d|[nsewmc]?b)$/.exec(id);
  if (!match?.[1]) return null;
  return PREFIX_CIRCUIT[match[1]] ?? null;
}

export function circuitJusticeFor(courtId: string | null | undefined): CircuitJustice | null {
  const circuit = circuitOfCourt(courtId);
  return circuit ? ALLOTMENT.find((row) => row.circuit === circuit) ?? null : null;
}

const ORDINAL: Readonly<Record<string, CircuitId>> = {
  first: "ca1", second: "ca2", third: "ca3", fourth: "ca4", fifth: "ca5", sixth: "ca6", seventh: "ca7",
  eighth: "ca8", ninth: "ca9", tenth: "ca10", eleventh: "ca11", "district of columbia": "cadc", federal: "cafc",
};

/** The circuit a court of appeals name refers to ("United States Court of Appeals for the Seventh Circuit"); null otherwise. */
export function circuitOfCourtName(name: string | null | undefined): CircuitId | null {
  const match = /Court\s+of\s+Appeals\s+for\s+the\s+(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|District\s+of\s+Columbia|Federal)\s+Circuit/i.exec(name ?? "");
  return match?.[1] ? ORDINAL[match[1].toLowerCase().replace(/\s+/g, " ")] ?? null : null;
}

export function circuitJusticeForCircuit(circuit: CircuitId | null): CircuitJustice | null {
  return circuit ? ALLOTMENT.find((row) => row.circuit === circuit) ?? null : null;
}
