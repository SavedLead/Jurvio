import { createHash } from "node:crypto";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { ArtifactStore } from "./artifact-store";
import { shouldCreateCase } from "../domain/direct-court";
import { fetchCmecfRss } from "../providers/courts/cmecf-rss";
import type { FederalCourtSource } from "../providers/courts/registry";

type Sql = ReturnType<typeof postgres>;

export async function ingestDirectCourtFeed(
  sql: Sql,
  artifactStore: ArtifactStore,
  court: FederalCourtSource,
) {
  const [prior] = await sql<{ feed_etag: string | null; feed_last_modified: string | null }[]>`
    SELECT feed_etag, feed_last_modified
    FROM direct_court_registry
    WHERE court_code = ${court.officialCourtCode}
  `;
  const retrieved = await fetchCmecfRss(court, { etag: prior?.feed_etag, lastModified: prior?.feed_last_modified });
  if (retrieved.notModified) {
    await sql`
      UPDATE direct_court_registry SET
        last_successful_retrieval = now(),
        feed_etag = COALESCE(${retrieved.etag}, feed_etag),
        feed_last_modified = COALESCE(${retrieved.lastModified}, feed_last_modified),
        health_state = 'healthy',
        consecutive_failures = 0,
        updated_at = now()
      WHERE court_code = ${court.officialCourtCode}
    `;
    return {
      court: court.officialCourtCode,
      notModified: true,
      inserted: 0,
      duplicated: 0,
      matched: 0,
      created: 0,
      published: 0,
      held: 0,
    };
  }
  const feedHash = createHash("sha256").update(retrieved.rawBody).digest("hex");
  const stored = await artifactStore.putIfAbsent({
    key: `official-courts/${court.officialCourtCode}/rss/${feedHash}.xml`,
    mediaType: "application/rss+xml",
    body: retrieved.rawBody,
    contentHash: feedHash,
  });
  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'official_cmecf'
  `;
  if (!provider) throw new Error("Official CM/ECF provider seed is missing");

  let inserted = 0;
  let duplicated = 0;
  let matched = 0;
  let created = 0;
  let published = 0;
  let held = 0;
  try {
    const [artifact] = await sql<{ id: string }[]>`
      INSERT INTO raw_artifact (
        provider_id, source_uri, source_record_id, content_hash, object_key,
        media_type, retrieved_at, response_metadata
      ) VALUES (
        ${provider.id}, ${court.rssUrl}, ${court.officialCourtCode + ":rss"},
        ${feedHash}, ${stored.objectKey}, 'application/rss+xml',
        ${retrieved.retrievedAt},
        ${sql.json({ courtCode: court.officialCourtCode, eventCount: retrieved.events.length })}
      )
      ON CONFLICT (provider_id, source_uri, content_hash)
      DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
      RETURNING id
    `;
    if (!artifact) throw new Error("Official feed artifact was not persisted");

    for (const event of retrieved.events) {
      await sql.begin(async (tx) => {
        const cases = await tx<{ id: string; public_id: string; publication: string }[]>`
          SELECT legal_case.id, legal_case.public_id, legal_case.publication::text
          FROM legal_case JOIN court ON court.id = legal_case.court_id
          WHERE lower(court.provider_court_id) = lower(${court.jurvioCourtCode})
            AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g'))
              = lower(regexp_replace(${event.docketNumber}, '[^a-zA-Z0-9]', '', 'g'))
          ORDER BY legal_case.created_at LIMIT 2
        `;
        let legalCase = cases.length === 1 ? cases[0] : null;
        if (cases.length > 1) legalCase = null;

        if (!legalCase && cases.length === 0 && shouldCreateCase(event)) {
          const [courtRecord] = await tx<{ id: string }[]>`
            INSERT INTO court (
              public_id, provider_id, provider_court_id, name, short_name,
              jurisdiction, verification, source_artifact_id
            ) VALUES (
              ${createPublicId("court")}, ${provider.id}, ${court.jurvioCourtCode},
              ${court.name}, ${court.officialCourtCode.toUpperCase()},
              'Federal District', 'verified', ${artifact.id}
            )
            ON CONFLICT (provider_id, provider_court_id)
            DO UPDATE SET source_artifact_id = EXCLUDED.source_artifact_id,
              verification = 'verified', updated_at = now()
            RETURNING id
          `;
          if (!courtRecord) throw new Error("Official court was not persisted");
          [legalCase] = await tx<{ id: string; public_id: string; publication: string }[]>`
            INSERT INTO legal_case (
              public_id, court_id, docket_number, caption, filed_on,
              verification, publication, source_artifact_id, source_updated_at
            ) VALUES (
              ${createPublicId("case")}, ${courtRecord.id}, ${event.docketNumber},
              ${event.caption}, ${event.eventType === "case_filed" ? event.filedAt.slice(0, 10) : null},
              'verified', 'draft', ${artifact.id}, ${event.filedAt}
            )
            ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
            DO UPDATE SET source_artifact_id = EXCLUDED.source_artifact_id,
              source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
            RETURNING id, public_id, publication::text
          `;
          if (legalCase) created += 1;
        }
        if (legalCase) matched += 1;

        const [directEvent] = await tx<{ id: string; was_new: boolean }[]>`
          INSERT INTO direct_court_event (
            court_code, case_id, raw_artifact_id, docket_number, caption,
            official_event_id, document_number, official_filed_at, exact_docket_text,
            event_type, visitor_description, official_source_url, document_url,
            content_hash, deduplication_key, restricted, publication_state
          ) VALUES (
            ${court.officialCourtCode}, ${legalCase?.id ?? null}, ${artifact.id},
            ${event.docketNumber}, ${event.caption}, ${event.officialEventId},
            ${event.documentNumber}, ${event.filedAt}, ${event.exactText},
            ${event.eventType}, ${event.visitorDescription}, ${event.sourceUrl},
            ${event.documentUrl}, ${event.contentHash}, ${event.deduplicationKey},
            ${event.restricted},
            ${event.restricted ? "suppressed" : legalCase ? "published" : "needs_review"}
          )
          ON CONFLICT (court_code, deduplication_key)
          DO UPDATE SET last_seen_at = now(), raw_artifact_id = EXCLUDED.raw_artifact_id,
            case_id = COALESCE(direct_court_event.case_id, EXCLUDED.case_id)
          RETURNING id, (xmax = 0) AS was_new
        `;
        if (!directEvent) throw new Error("Direct court event was not persisted");
        if (!directEvent.was_new) {
          duplicated += 1;
          return;
        }
        inserted += 1;
        if (event.restricted || !legalCase) {
          held += 1;
          return;
        }

        await tx`
          INSERT INTO docket_entry (
            public_id, case_id, provider_id, provider_entry_id,
            entry_number, filed_on, description, source_artifact_id
          ) VALUES (
            ${createPublicId("docketEntry")}, ${legalCase.id}, ${provider.id},
            ${event.deduplicationKey}, ${event.documentNumber},
            ${event.filedAt.slice(0, 10)}, ${event.exactText}, ${artifact.id}
          )
          ON CONFLICT (provider_id, provider_entry_id)
          DO UPDATE SET description = EXCLUDED.description,
            source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
        `;
        await tx`
          INSERT INTO direct_court_alert_event (
            direct_event_id, case_id, public_payload, deduplication_key
          ) VALUES (
            ${directEvent.id}, ${legalCase.id},
            ${tx.json({
              caseId: legalCase.public_id,
              court: court.name,
              docketNumber: event.docketNumber,
              caption: event.caption,
              eventType: event.eventType,
              description: event.visitorDescription,
              officialFilingTime: event.filedAt,
              officialSourceUrl: event.sourceUrl,
              documentAvailable: Boolean(event.documentUrl),
              materiality: event.eventType === "filing" ? "routine" : "material",
              deduplicationKey: event.deduplicationKey,
            })},
            ${event.deduplicationKey}
          ) ON CONFLICT (deduplication_key) DO NOTHING
        `;
        published += 1;
      });
    }
    await sql`
      UPDATE direct_court_registry SET checkpoint = ${feedHash},
        last_successful_retrieval = ${retrieved.retrievedAt},
        feed_etag = COALESCE(${retrieved.etag}, feed_etag),
        feed_last_modified = COALESCE(${retrieved.lastModified}, feed_last_modified),
        health_state = 'healthy', consecutive_failures = 0, updated_at = now()
      WHERE court_code = ${court.officialCourtCode}
    `;
  } catch (error) {
    await sql`
      UPDATE direct_court_registry SET health_state = 'degraded',
        consecutive_failures = consecutive_failures + 1, updated_at = now()
      WHERE court_code = ${court.officialCourtCode}
    `;
    throw error;
  }
  return {
    court: court.officialCourtCode,
    retrieved: retrieved.events.length,
    inserted,
    duplicated,
    matched,
    created,
    published,
    held,
    costCents: 0,
  };
}
