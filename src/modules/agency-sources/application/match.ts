import type postgres from "postgres";
import { normalizedDocketKeys, type DistrictDocket } from "../domain/district-docket";

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

export type MatchResult =
  | { status: "matched"; caseId: string }
  | { status: "unmatched" | "ambiguous" | "no_court"; caseId: null; note?: string };

const CAPTION_STOPWORDS = new Set([
  "united", "states", "america", "usa", "state", "people", "commission", "securities", "exchange", "federal", "trade",
  "the", "and", "inc", "llc", "ltd", "corp", "corporation", "company", "et", "al", "of", "in", "re", "matter", "sealed",
  "doe", "john", "jane", "defendant", "defendants", "plaintiff", "v", "vs",
]);

/** Distinctive caption words (party names), lowercased. */
export function captionTokens(caption: string): string[] {
  return [...new Set(caption.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((token) => token.length >= 4 && !CAPTION_STOPWORDS.has(token) && !/^\d+$/.test(token)))];
}

/**
 * A case matches only by court + docket number, and only if exactly one Jurvio case has it.
 * As a guard against the same number in a different court, the case caption must also
 * share a party name with the item (title + text). Otherwise the reference waits for review.
 */
export async function matchDistrictCase(sql: Sql, courtCode: string | null, docket: DistrictDocket, itemText: string): Promise<MatchResult> {
  if (!courtCode) return { status: "no_court", caseId: null };
  const keys = normalizedDocketKeys(docket);
  const rows = await sql<{ id: string; caption: string }[]>`
    SELECT DISTINCT legal_case.id, legal_case.caption
    FROM legal_case JOIN court ON court.id = legal_case.court_id
    WHERE lower(coalesce(court.provider_court_id, '')) = ${courtCode.toLowerCase()}
      AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g')) = ANY(${keys}::text[])
    LIMIT 3
  `;
  if (rows.length === 0) return { status: "unmatched", caseId: null };
  if (rows.length > 1) return { status: "ambiguous", caseId: null, note: `${rows.length} cases share this court and docket` };
  if (/\b(sealed|under seal)\b/i.test(rows[0]!.caption)) return { status: "ambiguous", caseId: null, note: "case caption is sealed" };
  const haystack = ` ${itemText.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  const tokens = captionTokens(rows[0]!.caption);
  if (tokens.length > 0 && !tokens.some((token) => haystack.includes(` ${token} `))) {
    return { status: "ambiguous", caseId: null, note: "case caption names no party the item mentions" };
  }
  return { status: "matched", caseId: rows[0]!.id };
}
