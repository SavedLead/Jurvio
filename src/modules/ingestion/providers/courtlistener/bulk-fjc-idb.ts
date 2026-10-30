import { createHash } from "node:crypto";
import { z } from "zod";
import { openBulkCsv, parseBulkCsv } from "./bulk";

// Federal Judicial Center Integrated Database, redistributed in CourtListener's
// bulk export as fjc-integrated-database-YYYY-MM-DD.csv.bz2.
//
// Unlike every other file in that export, IDB rows carry party names with the
// role already assigned by the FJC: `plaintiff` and `defendant` are separate
// columns, so nothing here has to parse a caption or guess who sued whom. The
// export contains no party or attorney table of its own, which makes this the
// only bulk source of party data available to us.
//
// The columns below are the ones the party backfill reads. passthrough() keeps
// the remaining ~30 IDB fields (nature of suit, disposition, judgment, ...)
// available for the content hash without forcing us to model them.
const nullableBulkString = z.string().transform((value) => value === "" ? null : value);

export const fjcIdbRowSchema = z.object({
  id: z.string().regex(/^\d+$/),
  office: z.string(),
  docket_number: z.string(),
  date_filed: nullableBulkString.optional(),
  date_terminated: nullableBulkString.optional(),
  plaintiff: z.string().optional().default(""),
  defendant: z.string().optional().default(""),
  circuit_id: z.string().optional().default(""),
  district_id: z.string().optional().default(""),
}).passthrough();

export type FjcIdbRow = z.infer<typeof fjcIdbRowSchema>;

export interface FjcIdbCaseKey {
  districtCode: string;
  office: string | null;
  docketCore: string;
  filingYear: number;
}

export function fjcIdbSourceUri(snapshotDate: string, rowId: string): string {
  return `https://www.courtlistener.com/help/api/bulk-data/#fjc-integrated-database-${snapshotDate}-${rowId}`;
}

export function fjcIdbContentHash(row: FjcIdbRow): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

/**
 * The identity an IDB row claims, or null when the row cannot address a case.
 *
 * A usable row needs a district (CourtListener's court code, e.g. "paed"), a
 * 7-character docket core, and a filing date. The core is the FJC's own
 * "DOCKET" field: a 2-digit filing year followed by a 5-digit sequence. Rows
 * that deviate from that shape are unmatchable rather than merely unusual, so
 * they are dropped here instead of being guessed at downstream.
 */
export function fjcIdbCaseKey(row: FjcIdbRow): FjcIdbCaseKey | null {
  const districtCode = row.district_id.trim().toLowerCase();
  if (!districtCode) return null;

  const docketCore = row.docket_number.trim();
  if (!/^\d{7}$/.test(docketCore)) return null;

  const filedOn = row.date_filed?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(filedOn)) return null;
  const filingYear = Number(filedOn.slice(0, 4));

  // The two-digit core year must agree with the four-digit filing date, or the
  // row is internally inconsistent and we cannot trust either value.
  if (docketCore.slice(0, 2) !== String(filingYear % 100).padStart(2, "0")) return null;

  const office = row.office.trim();
  return {
    districtCode,
    office: /^\d+$/.test(office) ? String(Number(office)) : null,
    docketCore,
    filingYear,
  };
}

export interface FjcIdbParty {
  role: "plaintiff" | "defendant";
  nameAsFiled: string;
}

function cleanPartyName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * The parties an IDB row states, in FJC role terms.
 *
 * Both columns hold the FIRST-LISTED party on each side, as recorded by the
 * court clerk; the IDB does not enumerate every party on a case. Names in older
 * records are truncated to the field width ("SOUTH TEX SPOR"), which is why the
 * value is preserved verbatim as the name as filed rather than being expanded,
 * corrected, or matched against anything.
 */
export function fjcIdbParties(row: FjcIdbRow): FjcIdbParty[] {
  const parties: FjcIdbParty[] = [];
  const plaintiff = cleanPartyName(row.plaintiff);
  const defendant = cleanPartyName(row.defendant);
  if (plaintiff) parties.push({ role: "plaintiff", nameAsFiled: plaintiff });
  if (defendant) parties.push({ role: "defendant", nameAsFiled: defendant });
  return parties;
}

export async function* readFjcIdbRows(filePath: string) {
  const source = openBulkCsv(filePath);
  try {
    yield* parseBulkCsv(source.stream, fjcIdbRowSchema);
    await source.completion;
  } finally {
    source.close();
  }
}
