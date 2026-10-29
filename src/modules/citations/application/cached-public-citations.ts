import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { caseCitationCounts, relatedCitationCases, type CaseCitationCounts, type RelatedCitationCase } from "./public-citations";

/** Citation lists can lag a publication by up to fifteen minutes. */
export const CASE_CITATION_REVALIDATE_SECONDS = 900;

export interface CachedCaseCitations {
  cited: RelatedCitationCase[];
  citing: RelatedCitationCase[];
  counts: CaseCitationCounts;
}

export const loadCachedCaseCitations = unstable_cache(
  async (casePublicId: string): Promise<CachedCaseCitations> => {
    const sql = db();
    const [cited, citing, counts] = await Promise.all([
      relatedCitationCases(sql, casePublicId, "cited"),
      relatedCitationCases(sql, casePublicId, "citing"),
      caseCitationCounts(sql, casePublicId),
    ]);
    return { cited, citing, counts };
  },
  ["public-case-citations-v1"],
  { revalidate: CASE_CITATION_REVALIDATE_SECONDS },
);
