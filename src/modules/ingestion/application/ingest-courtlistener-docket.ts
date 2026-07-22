import type postgres from "postgres";
import { fetchDocket } from "../providers/courtlistener/client";
import type { ArtifactStore } from "./artifact-store";
import { ingestCourtListenerParties } from "./ingest-courtlistener-parties";
import { ingestCourtListenerDocketEntries } from "./ingest-courtlistener-docket-entries";
import { persistCourtListenerCase } from "./persist-courtlistener-case";

type Sql = ReturnType<typeof postgres>;

export async function ingestCourtListenerDocket(
  sql: Sql,
  artifactStore: ArtifactStore,
  docketId: number,
) {
  const retrieved = await fetchDocket(docketId);
  const caseResult = await persistCourtListenerCase(sql, artifactStore, retrieved);

  const parties = await ingestCourtListenerParties(sql, artifactStore, {
    providerId: caseResult.providerId,
    caseId: caseResult.internalCaseId,
    docketId,
  });

  const docketEntries = await ingestCourtListenerDocketEntries(sql, artifactStore, {
    providerId: caseResult.providerId,
    caseId: caseResult.internalCaseId,
    docketId,
  });

  return {
    caseId: caseResult.caseId,
    sourceCaseId: caseResult.sourceCaseId,
    rawArtifactId: caseResult.rawArtifactId,
    parties,
    docketEntries,
  };
}
