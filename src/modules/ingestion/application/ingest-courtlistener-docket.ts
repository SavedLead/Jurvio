import type postgres from "postgres";
import { CourtListenerNotModified, fetchDocket } from "../providers/courtlistener/client";
import type { ArtifactStore } from "./artifact-store";
import { ingestCourtListenerParties } from "./ingest-courtlistener-parties";
import { ingestCourtListenerDocketEntries } from "./ingest-courtlistener-docket-entries";
import { persistCourtListenerCase } from "./persist-courtlistener-case";

type Sql = ReturnType<typeof postgres>;

async function stampFetched(
  sql: Sql,
  caseId: string,
  validators: { etag?: string; lastModified?: string },
): Promise<void> {
  await sql`
    UPDATE legal_case SET
      last_fetched_at = now(),
      source_http_etag = COALESCE(${validators.etag ?? null}, source_http_etag),
      source_http_last_modified = COALESCE(${validators.lastModified ?? null}, source_http_last_modified)
    WHERE id = ${caseId}
  `;
}

export async function ingestCourtListenerDocket(
  sql: Sql,
  artifactStore: ArtifactStore,
  docketId: number,
) {
  const [stored] = await sql<{
    case_id: string;
    etag: string | null;
    last_modified: string | null;
  }[]>`
    SELECT c.id AS case_id, c.source_http_etag AS etag, c.source_http_last_modified AS last_modified
    FROM case_identifier identifier
    JOIN legal_case c ON c.id = identifier.case_id
    WHERE identifier.identifier_type = 'courtlistener_docket_id'
      AND identifier.identifier_value = ${String(docketId)}
      AND identifier.provider_id = (SELECT id FROM provider WHERE code = 'courtlistener')
    LIMIT 1
  `;
  let retrieved;
  try {
    retrieved = await fetchDocket(docketId, stored ? { etag: stored.etag, lastModified: stored.last_modified } : null);
  } catch (error) {
    if (error instanceof CourtListenerNotModified && stored) {
      await stampFetched(sql, stored.case_id, { etag: error.etag, lastModified: error.lastModified });
      return {
        notModified: true,
        caseId: "",
        sourceCaseId: String(docketId),
        rawArtifactId: "",
        parties: { accepted: 0, rejected: 0 },
        docketEntries: { accepted: 0, rejected: 0, documents: 0 },
      };
    }
    throw error;
  }
  const caseResult = await persistCourtListenerCase(sql, artifactStore, retrieved);
  await stampFetched(sql, caseResult.internalCaseId, {
    etag: retrieved.responseMetadata.etag,
    lastModified: retrieved.responseMetadata.lastModified,
  });

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
