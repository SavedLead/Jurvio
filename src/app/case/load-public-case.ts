import { cache } from "react";
import { db } from "@/db/client";
import { getPublicCase, type PublicCase } from "@/modules/cases/application/get-public-case";

const CASE_ID = /^jv-[a-z0-9]{8,10}$/;

/**
 * One case lookup per request. generateMetadata and the page both call this;
 * React cache() dedupes them for the same public id.
 */
export const loadRequestPublicCase = cache(async (caseId: string): Promise<PublicCase | null> => {
  if (!CASE_ID.test(caseId)) return null;
  return getPublicCase(db(), caseId);
});
