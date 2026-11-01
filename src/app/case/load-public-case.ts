import { cache } from "react";
import { db } from "@/db/client";
import { getPublicCase, type PublicCase } from "@/modules/cases/application/get-public-case";
import { viewerHasSubscriberAccess } from "@/modules/accounts/http/viewer";
import { resolveCaseAccess, type CaseAccess } from "@/modules/accounts/application/case-access";

const CASE_ID = /^jv-[a-z0-9]{8,10}$/;

/**
 * One case lookup per request. generateMetadata and the page both call this;
 * React cache() dedupes them for the same public id.
 */
export const loadRequestPublicCase = cache(async (caseId: string): Promise<PublicCase | null> => {
  if (!CASE_ID.test(caseId)) return null;
  return getPublicCase(db(), caseId);
});

/**
 * Case lookup plus the subscriber-only gate. Every /case/<id> page must use
 * this (not loadRequestPublicCase) so a gated case never reaches metadata,
 * JSON-LD or the body.
 */
export const loadCaseForViewer = cache(async (caseId: string): Promise<CaseAccess> =>
  resolveCaseAccess(await loadRequestPublicCase(caseId), viewerHasSubscriberAccess));
