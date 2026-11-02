import type postgres from "postgres";
import { citationCaseVisibleSql, citationDocumentVisibleSql } from "@/modules/citations/application/citation-edges";
import { citingCourtKind, summarizeReach, type CitationReach, type CitingCourtRow } from "@/modules/scotus/domain/ramifications";

type Sql = ReturnType<typeof postgres>;

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: CitationReach | null }>();

/**
 * How later cases on Jurvio cite this case, grouped by the citing court. One
 * aggregate over case_citation_edge (index on cited_case_id) with the same
 * visibility checks the "Cited by" list uses, under a 2 s statement timeout;
 * cached per process for 30 minutes. Null (never throws) when it times out or
 * the edge table is not built yet, so the page shows the plain count instead.
 */
export async function loadCitationReach(sql: Sql, casePublicId: string): Promise<CitationReach | null> {
  const hit = cache.get(casePublicId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: CitationReach | null = null;
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2000ms'`;
      return tx<Array<{ courtPublicId: string | null; courtName: string; jurisdiction: string | null; providerCourtId: string | null; cases: number; first: string | null; last: string | null; recent: number }>>`
        SELECT court.public_id AS "courtPublicId", court.name AS "courtName", court.jurisdiction,
          court.provider_court_id AS "providerCourtId", count(*)::int AS cases,
          min(e.citing_filed_on)::text AS first, max(e.citing_filed_on)::text AS last,
          count(*) FILTER (WHERE e.citing_filed_on >= current_date - interval '5 years')::int AS recent
        FROM legal_case current_case
        JOIN case_citation_edge e ON e.cited_case_id = current_case.id
        JOIN legal_case related ON related.id = e.citing_case_id
        JOIN court ON court.id = related.court_id
        JOIN document d ON d.id = e.citing_document_id
        WHERE current_case.public_id = ${casePublicId}
          AND related.id <> current_case.id
          AND ${tx.unsafe(citationCaseVisibleSql("current_case"))}
          AND ${tx.unsafe(citationCaseVisibleSql("related"))}
          AND ${tx.unsafe(citationDocumentVisibleSql("d"))}
        GROUP BY court.id
      `;
    });
    if (rows.length) {
      const courtRows: CitingCourtRow[] = rows.map((row) => ({
        courtPublicId: row.courtPublicId, courtName: row.courtName,
        courtKind: citingCourtKind(row.jurisdiction, row.providerCourtId), cases: row.cases,
      }));
      const first = rows.map((row) => row.first).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
      const last = rows.map((row) => row.last).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
      value = summarizeReach(courtRows, { first, last, lastFiveYears: rows.reduce((sum, row) => sum + row.recent, 0) });
    }
  } catch {
    value = null;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(casePublicId, { at: Date.now(), value });
  return value;
}
