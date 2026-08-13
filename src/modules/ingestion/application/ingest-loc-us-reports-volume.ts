import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { ArtifactStore } from "./artifact-store";
import { finishIngestionRun, finishIngestionRunItem, startIngestionRun, startIngestionRunItem } from "./ingestion-run";
import { fetchLocUsReportsVolume } from "../providers/scotus/loc-us-reports";

type Sql = ReturnType<typeof postgres>;

export async function ingestLocUsReportsVolume(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: { volume: number; limit: number; resume: boolean },
) {
  if (!Number.isInteger(options.volume) || options.volume < 2 || options.volume > 501) throw new Error("Unsupported pre-502 volume");
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error("Batch limit must be between 1 and 1000");
  const index = await fetchLocUsReportsVolume(options.volume);
  if (index.records.length === 0) throw new Error(`Library of Congress returned no cases for Volume ${options.volume}`);
  const [provider] = await sql<{ id: string }[]> `SELECT id FROM provider WHERE code = 'scotus_official'`;
  if (!provider) throw new Error("Official Supreme Court provider seed is missing");
  const streamName = `official:loc-us-reports:${options.volume}`;
  const [checkpoint] = options.resume ? await sql<{ cursor_value: string }[]> `
    SELECT cursor_value FROM ingestion_checkpoint WHERE provider_id = ${provider.id} AND stream_name = ${streamName}
  ` : [];
  const checkpointIndex = checkpoint ? index.records.findIndex((record) => record.sourceRecordId === checkpoint.cursor_value) : -1;
  if (checkpoint && checkpointIndex < 0) throw new Error("Stored Library of Congress checkpoint is absent from the current volume");
  const selected = index.records.slice(checkpointIndex + 1, checkpointIndex + 1 + options.limit);
  const runId = await startIngestionRun(sql, {
    providerCode: "scotus_official",
    runType: "official_scotus_loc_us_reports",
    selection: { volume: options.volume, limit: options.limit, checkpoint: checkpoint?.cursor_value ?? null, sourceUri: index.sourceUri },
    selectedCount: selected.length,
  });
  const listingStored = await artifactStore.putIfAbsent({
    key: `scotus/loc-us-reports/${options.volume}/index-${index.contentHash}.json`,
    mediaType: "application/json",
    body: index.rawBody,
    contentHash: index.contentHash,
  });
  const [listingArtifact] = await sql<{ id: string }[]> `
    INSERT INTO raw_artifact (provider_id, ingestion_run_id, source_uri, source_record_id,
      content_hash, object_key, media_type, retrieved_at, response_metadata)
    VALUES (${provider.id}, ${runId}, ${index.sourceUri}, ${`loc-volume:${options.volume}`},
      ${index.contentHash}, ${listingStored.objectKey}, 'application/json', ${index.retrievedAt},
      ${sql.json({ volume: options.volume, recordCount: index.records.length })})
    ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at RETURNING id
  `;
  if (!listingArtifact) throw new Error("Library of Congress listing artifact was not persisted");
  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ sourceRecordId: string; reason: string }> = [];
  let lastContiguousSourceRecordId: string | null = null;
  let sawFailure = false;
  try {
    for (const record of selected) {
      await startIngestionRunItem(sql, runId, record.sourceRecordId);
      try {
        // Metadata-first ingestion. The Library of Congress collection catalog already
        // carries the authoritative case name, reporter citation ("N U.S. Page") and
        // decision year for every case in the volume, so the case record is created
        // directly from that JSON -- no per-case PDF download. LoC rate-limits per-case
        // PDF fetches (429), and the PDF is only needed later for the reader, which the
        // text-extraction worker fetches lazily from source_pdf_uri. The reporter
        // citation is the case identity; a synthetic volume+page docket keeps rows
        // distinct without a docket number the seriatim era never assigned. The volume
        // listing artifact stands in as the source artifact.
        const contentHash = createHash("sha256")
          .update(`${record.sourceRecordId}|${record.citation}|${record.caseName}`)
          .digest("hex");
        await sql`
          INSERT INTO official_opinion_candidate (provider_id, term_year, source_record_id,
            release_number, docket_number, case_name, filed_on, author_code, citation,
            source_pdf_uri, source_content_hash, listing_artifact_id, opinion_artifact_id,
            source_page_start, source_page_end)
          VALUES (${provider.id}, ${String(record.decisionYear).slice(-2)}, ${record.sourceRecordId}, NULL,
            ${`${record.volume}US${record.reporterPage}`}, ${record.caseName},
            ${`${record.decisionYear}-01-01`}, NULL, ${record.citation},
            ${record.pdfUrl}, ${contentHash}, ${listingArtifact.id}, ${listingArtifact.id}, NULL, NULL)
          ON CONFLICT (provider_id, source_record_id) DO UPDATE SET
            docket_number = EXCLUDED.docket_number, case_name = EXCLUDED.case_name,
            filed_on = EXCLUDED.filed_on, citation = EXCLUDED.citation,
            source_pdf_uri = EXCLUDED.source_pdf_uri, source_content_hash = EXCLUDED.source_content_hash,
            listing_artifact_id = EXCLUDED.listing_artifact_id, last_seen_at = now()
        `;
        await finishIngestionRunItem(sql, { runId, sourceRecordId: record.sourceRecordId, documentCount: 0 });
        if (!sawFailure) lastContiguousSourceRecordId = record.sourceRecordId;
        succeeded += 1;
      } catch (error) {
        sawFailure = true;
        failed += 1;
        const reason = error instanceof Error ? error.message : "Library of Congress case ingestion failed";
        failures.push({ sourceRecordId: record.sourceRecordId, reason });
        await finishIngestionRunItem(sql, { runId, sourceRecordId: record.sourceRecordId, error: reason });
      }
    }
    if (lastContiguousSourceRecordId !== null) {
      await sql `
        INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
        VALUES (${provider.id}, ${streamName}, ${lastContiguousSourceRecordId})
        ON CONFLICT (provider_id, stream_name) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
      `;
    }
    await finishIngestionRun(sql, runId);
    return { runId, volume: options.volume, discovered: index.records.length, selected: selected.length, succeeded, failed, failures };
  } catch (error) {
    await finishIngestionRun(sql, runId, error instanceof Error ? error.message : "Library of Congress ingestion failed");
    throw error;
  }
}
