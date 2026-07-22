import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { normalizeCourtListenerParty } from "../normalize/party";
import { fetchDocketParties } from "../providers/courtlistener/client";
import type { ArtifactStore } from "./artifact-store";

type Sql = ReturnType<typeof postgres>;

export async function ingestCourtListenerParties(
  sql: Sql,
  artifactStore: ArtifactStore,
  input: { providerId: string; caseId: string; docketId: number },
): Promise<{ accepted: number; rejected: number }> {
  const retrievedParties = await fetchDocketParties(input.docketId);
  let accepted = 0;
  let rejected = 0;

  for (const retrieved of retrievedParties) {
    const sourceRecordId = String(retrieved.record.id);
    const stored = await artifactStore.putIfAbsent({
      key: `courtlistener/parties/${sourceRecordId}/${retrieved.contentHash}.json`,
      mediaType: "application/json",
      body: retrieved.rawBody,
      contentHash: retrieved.contentHash,
    });

    await sql.begin(async (tx) => {
      const [artifact] = await tx<{ id: string }[]>`
        INSERT INTO raw_artifact (
          provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata
        ) VALUES (
          ${input.providerId}, ${retrieved.sourceUri}, ${sourceRecordId},
          ${retrieved.contentHash}, ${stored.objectKey}, 'application/json',
          ${retrieved.retrievedAt}, ${tx.json(retrieved.responseMetadata)}
        )
        ON CONFLICT (provider_id, source_uri, content_hash)
        DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!artifact) throw new Error("Party raw artifact was not persisted");

      let normalized;
      try {
        normalized = normalizeCourtListenerParty(retrieved.record, input.docketId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown normalization error";
        await tx`
          INSERT INTO ingestion_rejection (
            provider_id, source_uri, source_record_id, reason_code,
            error_message, raw_artifact_id
          ) VALUES (
            ${input.providerId}, ${retrieved.sourceUri}, ${sourceRecordId},
            'party_normalization_failed', ${message}, ${artifact.id}
          )
          ON CONFLICT (
            provider_id, source_uri, source_record_id, reason_code, resolved_at
          )
          DO UPDATE SET
            error_message = EXCLUDED.error_message,
            raw_artifact_id = EXCLUDED.raw_artifact_id,
            last_seen_at = now()
        `;
        rejected += 1;
        return;
      }

      const identityLock = `courtlistener-party:${normalized.sourcePartyId}`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identityLock}, 0))`;

      const [existing] = await tx<{ entity_id: string }[]>`
        SELECT entity_id
        FROM entity_identifier
        WHERE provider_id = ${input.providerId}
          AND identifier_type = 'courtlistener_party_id'
          AND identifier_value = ${normalized.sourcePartyId}
      `;

      let entityId = existing?.entity_id;
      if (!entityId) {
        const [entity] = await tx<{ id: string }[]>`
          INSERT INTO entity (
            public_id, entity_type, display_name, normalized_name,
            verification, source_artifact_id
          ) VALUES (
            ${createPublicId("entity")}, 'unknown', ${normalized.displayName},
            ${normalized.normalizedName}, 'not_verified', ${artifact.id}
          )
          RETURNING id
        `;
        if (!entity) throw new Error("Party entity was not persisted");
        entityId = entity.id;

        await tx`
          INSERT INTO entity_identifier (
            entity_id, provider_id, identifier_type, identifier_value
          ) VALUES (
            ${entityId}, ${input.providerId}, 'courtlistener_party_id',
            ${normalized.sourcePartyId}
          )
        `;
      } else {
        await tx`
          UPDATE entity
          SET display_name = ${normalized.displayName},
              normalized_name = ${normalized.normalizedName},
              source_artifact_id = ${artifact.id},
              updated_at = now()
          WHERE id = ${entityId}
        `;
      }

      for (const role of normalized.roles) {
        await tx`
          INSERT INTO party_appearance (
            case_id, entity_id, role, party_name_as_filed,
            ended_on, source_artifact_id
          ) VALUES (
            ${input.caseId}, ${entityId}, ${role.role},
            ${role.nameAsFiled}, ${role.endedOn ?? null}, ${artifact.id}
          )
          ON CONFLICT (case_id, entity_id, role, started_on)
          DO UPDATE SET
            party_name_as_filed = EXCLUDED.party_name_as_filed,
            ended_on = EXCLUDED.ended_on,
            source_artifact_id = EXCLUDED.source_artifact_id
        `;
      }

      accepted += 1;
    });
  }

  return { accepted, rejected };
}
