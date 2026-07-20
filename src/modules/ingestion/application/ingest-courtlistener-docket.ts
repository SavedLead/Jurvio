import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { fetchDocket } from "../providers/courtlistener/client";
import { normalizeCourtListenerDocket } from "../normalize/courtlistener";
import type { ArtifactStore } from "./artifact-store";
import { ingestCourtListenerParties } from "./ingest-courtlistener-parties";
import { ingestCourtListenerDocketEntries } from "./ingest-courtlistener-docket-entries";

type Sql = ReturnType<typeof postgres>;

function providerCourtId(uri: string): string {
  const parts = uri.split("/").filter(Boolean);
  return parts.at(-1) ?? uri;
}

export async function ingestCourtListenerDocket(
  sql: Sql,
  artifactStore: ArtifactStore,
  docketId: number,
) {
  const retrieved = await fetchDocket(docketId);
  const normalized = normalizeCourtListenerDocket(retrieved.record);
  const stored = await artifactStore.putIfAbsent({
    key: `courtlistener/dockets/${docketId}/${retrieved.contentHash}.json`,
    mediaType: "application/json",
    body: retrieved.rawBody,
    contentHash: retrieved.contentHash,
  });

  const caseResult = await sql.begin(async (tx) => {
    const [provider] = await tx<{ id: string }[]>`
      SELECT id FROM provider WHERE code = 'courtlistener'
    `;
    if (!provider) throw new Error("CourtListener provider seed is missing");

    const [artifact] = await tx<{ id: string }[]>`
      INSERT INTO raw_artifact (
        provider_id, source_uri, source_record_id, content_hash, object_key,
        media_type, retrieved_at, response_metadata
      ) VALUES (
        ${provider.id}, ${retrieved.sourceUri}, ${normalized.sourceCaseId},
        ${retrieved.contentHash}, ${stored.objectKey}, 'application/json',
        ${retrieved.retrievedAt}, ${tx.json(retrieved.responseMetadata)}
      )
      ON CONFLICT (provider_id, source_uri, content_hash)
      DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
      RETURNING id
    `;
    if (!artifact) throw new Error("Raw artifact was not persisted");

    const courtCode = providerCourtId(normalized.sourceCourtUri);
    const [court] = await tx<{ id: string }[]>`
      INSERT INTO court (
        public_id, provider_id, provider_court_id, name, short_name,
        verification, source_artifact_id
      ) VALUES (
        ${createPublicId("court")}, ${provider.id}, ${courtCode},
        ${courtCode.toUpperCase()}, ${courtCode.toUpperCase()},
        'not_verified', ${artifact.id}
      )
      ON CONFLICT (provider_id, provider_court_id)
      DO UPDATE SET source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
      RETURNING id
    `;
    if (!court) throw new Error("Court was not persisted");

    const [legalCase] = await tx<{ id: string; public_id: string }[]>`
      INSERT INTO legal_case (
        public_id, court_id, docket_number, caption, filed_on, terminated_on,
        nature_of_suit_code, cause_of_action, verification, publication,
        source_artifact_id, source_updated_at
      ) VALUES (
        ${createPublicId("case")}, ${court.id}, ${normalized.docketNumber},
        ${normalized.caption}, ${normalized.filedOn ?? null},
        ${normalized.terminatedOn ?? null}, ${normalized.natureOfSuit ?? null},
        ${normalized.causeOfAction ?? null}, 'not_verified', 'draft',
        ${artifact.id}, ${normalized.sourceUpdatedAt}
      )
      ON CONFLICT (court_id, docket_number)
      DO UPDATE SET
        caption = EXCLUDED.caption,
        filed_on = EXCLUDED.filed_on,
        terminated_on = EXCLUDED.terminated_on,
        nature_of_suit_code = EXCLUDED.nature_of_suit_code,
        cause_of_action = EXCLUDED.cause_of_action,
        source_artifact_id = EXCLUDED.source_artifact_id,
        source_updated_at = EXCLUDED.source_updated_at,
        updated_at = now()
      RETURNING id, public_id
    `;
    if (!legalCase) throw new Error("Case was not persisted");

    await tx`
      INSERT INTO case_identifier (
        case_id, provider_id, identifier_type, identifier_value
      ) VALUES (
        ${legalCase.id}, ${provider.id}, 'courtlistener_docket_id',
        ${normalized.sourceCaseId}
      )
      ON CONFLICT (provider_id, identifier_type, identifier_value)
      DO UPDATE SET case_id = EXCLUDED.case_id
    `;

    await tx`
      INSERT INTO outbox_event (
        topic, aggregate_type, aggregate_id, aggregate_version, payload
      ) VALUES (
        'case.changed', 'legal_case', ${legalCase.id},
        (extract(epoch from clock_timestamp()) * 1000000)::bigint,
        ${tx.json({ caseId: legalCase.public_id, source: "courtlistener" })}
      )
    `;

    return {
      caseId: legalCase.public_id,
      internalCaseId: legalCase.id,
      providerId: provider.id,
      sourceCaseId: normalized.sourceCaseId,
      rawArtifactId: artifact.id,
    };
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
