import { z } from "zod";
import { parseBulkCsv, type BulkCsvSource } from "./bulk";

// courts-<snapshot>.csv columns (verified against the real bulk file):
//   id,pacer_court_id,pacer_has_rss_feed,pacer_rss_entry_types,date_last_pacer_contact,
//   fjc_court_id,date_modified,in_use,has_opinion_scraper,has_oral_argument_scraper,
//   position,citation_string,short_name,full_name,url,start_date,end_date,jurisdiction,
//   notes,parent_court_id
//
// For federal court-code selection we consume only `id` (the CourtListener court
// code, e.g. `ca9`, `cand`, `nysd`, `cit`) and `jurisdiction`. .passthrough()
// keeps every other column so a change to CourtListener's column set never breaks
// the parse.
export const courtListenerBulkCourtCodeSchema = z
  .object({
    id: z.string().min(1),
    jurisdiction: z.string().optional().default(""),
  })
  .passthrough();

export type CourtListenerBulkCourtCode = z.infer<typeof courtListenerBulkCourtCodeSchema>;

// CourtListener jurisdiction codes for the federal court system:
//   F   = Federal Appellate  (the 13 circuit courts of appeals)
//   FD  = Federal District   (~94 U.S. district courts)
//   FS  = Federal Special    (e.g. CIT, Court of Federal Claims, Tax Court)
//   FB  = Federal Bankruptcy
//   FBP = Federal Bankruptcy Panel (BAPs)
// State/tribal/military codes (S, SA, SAG, ST, SS, ...) are never federal.
export const FEDERAL_JURISDICTION_CODES: ReadonlySet<string> = new Set(["F", "FD", "FS"]);
export const FEDERAL_BANKRUPTCY_JURISDICTION_CODES: ReadonlySet<string> = new Set(["FB", "FBP"]);

/**
 * True when a CourtListener jurisdiction code belongs to the federal court system.
 * Default selection is appellate + district + special ({F, FD, FS}); bankruptcy
 * ({FB, FBP}) is only included when `includeBankruptcy` is set — it is enormous and
 * low-value, so it is opt-in.
 */
export function isFederalCourtJurisdiction(
  jurisdiction: string | null | undefined,
  includeBankruptcy: boolean,
): boolean {
  const code = (jurisdiction ?? "").trim().toUpperCase();
  if (FEDERAL_JURISDICTION_CODES.has(code)) return true;
  return includeBankruptcy && FEDERAL_BANKRUPTCY_JURISDICTION_CODES.has(code);
}

/** Pure selection over an iterable of court rows; returns the set of federal codes. */
export function selectFederalCourtCodes(
  courts: Iterable<{ id: string; jurisdiction?: string | null }>,
  includeBankruptcy: boolean,
): Set<string> {
  const codes = new Set<string>();
  for (const court of courts) {
    if (isFederalCourtJurisdiction(court.jurisdiction, includeBankruptcy)) {
      codes.add(court.id);
    }
  }
  return codes;
}

/**
 * Stream the tiny `courts` bulk file and collect the set of federal court codes.
 * The file is streamed+decompressed like every other bulk file (never landed on
 * disk); the caller supplies the {@link BulkCsvSource} (typically from
 * `openBulkCsvFromUrl`). The resulting set is small (~200 codes) and drives the
 * docket filter for the federal opinion loader.
 */
export async function readFederalCourtCodes(
  source: BulkCsvSource,
  options: { includeBankruptcy: boolean },
): Promise<Set<string>> {
  const codes = new Set<string>();
  try {
    for await (const court of parseBulkCsv(source.stream, courtListenerBulkCourtCodeSchema)) {
      if (isFederalCourtJurisdiction(court.jurisdiction, options.includeBankruptcy)) {
        codes.add(court.id);
      }
    }
    await source.completion;
    return codes;
  } finally {
    source.close();
  }
}
