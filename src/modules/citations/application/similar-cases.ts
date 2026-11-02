import type postgres from "postgres";
import { citationCaseVisibleSql } from "@/modules/citations/application/citation-edges";

type Sql = ReturnType<typeof postgres>;

export interface SimilarCase {
  publicId: string;
  caption: string;
  courtName: string;
  decidedOn: string | null;
  shared: number;
  /** Up to three of the authorities both cases cite, least-cited first (the most telling overlap). */
  sharedAuthorities: Array<{ publicId: string; caption: string }>;
}

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: SimilarCase[] }>();

/**
 * "Cases like this": other public cases whose opinions cite at least two of the same earlier cases
 * (bibliographic coupling). Uses this case's 40 least-cited authorities (rare shared citations say
 * more than shared landmark ones) and at most 500 citing cases per authority, under a 2.5 s statement
 * timeout; cached 30 minutes. Empty (never throws) when it times out or the edge table is missing.
 */
export async function loadSimilarCases(sql: Sql, casePublicId: string, limit = 5): Promise<SimilarCase[]> {
  const hit = cache.get(casePublicId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: SimilarCase[] = [];
  try {
    value = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2500ms'`;
      const rows = await tx<Array<{ id: string; publicId: string; caption: string; courtName: string; decidedOn: string | null; shared: number; authorityIds: string[] }>>`
        WITH me AS (
          SELECT lc.id FROM legal_case lc WHERE lc.public_id = ${casePublicId} AND ${tx.unsafe(citationCaseVisibleSql("lc"))}
        ), rare AS (
          SELECT e.cited_case_id FROM me JOIN case_citation_edge e ON e.citing_case_id = me.id
          JOIN legal_case cited ON cited.id = e.cited_case_id
          LEFT JOIN case_citation_count count ON count.case_id = e.cited_case_id
          WHERE e.cited_case_id <> me.id AND ${tx.unsafe(citationCaseVisibleSql("cited"))}
          ORDER BY coalesce(count.cited_by, 0) ASC LIMIT 40
        ), pairs AS (
          SELECT other.citing_case_id AS other_id, count(*)::int AS shared, array_agg(rare.cited_case_id) AS authority_ids
          FROM rare CROSS JOIN me
          CROSS JOIN LATERAL (SELECT e.citing_case_id FROM case_citation_edge e WHERE e.cited_case_id = rare.cited_case_id AND e.citing_case_id <> me.id LIMIT 500) other
          GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 40
        )
        SELECT lc.id, lc.public_id AS "publicId", lc.caption, court.name AS "courtName", lc.decided_on::text AS "decidedOn",
          pairs.shared, pairs.authority_ids::text[] AS "authorityIds"
        FROM pairs JOIN legal_case lc ON lc.id = pairs.other_id JOIN court ON court.id = lc.court_id
        WHERE ${tx.unsafe(citationCaseVisibleSql("lc"))}
        ORDER BY pairs.shared DESC, lc.decided_on DESC NULLS LAST LIMIT ${limit}
      `;
      if (!rows.length) return [];
      const ids = [...new Set(rows.flatMap((row) => row.authorityIds.slice(0, 3)))];
      const authorities = await tx<Array<{ id: string; publicId: string; caption: string }>>`
        SELECT lc.id, lc.public_id AS "publicId", lc.caption FROM legal_case lc WHERE lc.id = ANY(${ids}::uuid[]) AND ${tx.unsafe(citationCaseVisibleSql("lc"))}
      `;
      const byId = new Map(authorities.map((row) => [row.id, row]));
      return rows.map((row) => ({
        publicId: row.publicId, caption: row.caption, courtName: row.courtName, decidedOn: row.decidedOn, shared: row.shared,
        sharedAuthorities: row.authorityIds.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 3)
          .map((item) => ({ publicId: item.publicId, caption: item.caption })),
      }));
    });
  } catch {
    value = [];
  }
  if (cache.size > 2000) cache.clear();
  cache.set(casePublicId, { at: Date.now(), value });
  return value;
}
