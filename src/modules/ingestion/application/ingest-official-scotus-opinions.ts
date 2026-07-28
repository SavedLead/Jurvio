import type postgres from "postgres";
import type { ArtifactStore } from "./artifact-store";
import { finishIngestionRun, finishIngestionRunItem, startIngestionRun, startIngestionRunItem } from "./ingestion-run";
import { fetchOfficialOpinionPdf, fetchOfficialSlipOpinionIndex } from "../providers/scotus/official-opinions";

type Sql = ReturnType<typeof postgres>;

export interface OfficialScotusIngestionOptions {
  termYear: string;
  limit: number;
  resume: boolean;
}

export function normalizeOfficialScotusIngestionOptions(input: OfficialScotusIngestionOptions) {
  if (!/^\d{2}$/.test(input.termYear)) throw new Error("Supreme Court term must be a two-digit year");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Batch limit must be between 1 and 100");
  return input;
}

export function selectOfficialScotusBatch<T extends { sourceRecordId: string }>(
  records: T[],
  limit: number,
  checkpoint: string | null,
) {
  if (!checkpoint) return records.slice(0, limit);
  const checkpointIndex = records.findIndex((record) => record.sourceRecordId === checkpoint);
  if (checkpointIndex < 0) {
    throw new Error("Stored Supreme Court checkpoint is not present in the current official index");
  }
  return records.slice(checkpointIndex + 1, checkpointIndex + 1 + limit);
}

export async function ingestOfficialScotusOpinions(
  sql: Sql,
  artifactStore: ArtifactStore,
  rawOptions: OfficialScotusIngestionOptions,
) {
  const options = normalizeOfficialScotusIngestionOptions(rawOptions);
  const index = await fetchOfficialSlipOpinionIndex(options.termYear);
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'scotus_official'`;
  if (!provider) throw new Error("Official Supreme Court provider seed is missing");

  const [checkpoint] = options.resume ? await sql<{ cursor_value: string }[]>`
    SELECT cursor_value FROM ingestion_checkpoint
    WHERE provider_id = ${provider.id} AND stream_name = ${`official:slip-opinions:${options.termYear}`}
  ` : [];
  const selected = selectOfficialScotusBatch(
    index.records,
    options.limit,
    checkpoint?.cursor_value ?? null,
  );
  const runId = await startIngestionRun(sql, {
    providerCode: "scotus_official", runType: "official_scotus_slip_opinions",
    selection: { termYear: options.termYear, limit: options.limit, resume: options.resume,
      sourceUri: index.sourceUri, checkpoint: checkpoint?.cursor_value ?? null },
    selectedCount: selected.length,
  });

  try {
    const listingStored = await artifactStore.putIfAbsent({
      key: `scotus/slip-opinions/${options.termYear}/index-${index.contentHash}.html`,
      mediaType: "text/html", body: index.rawBody, contentHash: index.contentHash,
    });
    const [listingArtifact] = await sql<{ id: string }[]>`
      INSERT INTO raw_artifact (provider_id, ingestion_run_id, source_uri, source_record_id,
        content_hash, object_key, media_type, retrieved_at, response_metadata)
      VALUES (${provider.id}, ${runId}, ${index.sourceUri}, ${`term:${options.termYear}`},
        ${index.contentHash}, ${listingStored.objectKey}, 'text/html', ${index.retrievedAt},
        ${sql.json({ termYear: options.termYear, recordCount: index.records.length })})
      ON CONFLICT (provider_id, source_uri, content_hash)
      DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
      RETURNING id
    `;
    if (!listingArtifact) throw new Error("Official Supreme Court index artifact was not persisted");

    let succeeded = 0;
    let failed = 0;
    for (const record of selected) {
      await startIngestionRunItem(sql, runId, record.sourceRecordId);
      try {
        const pdf = await fetchOfficialOpinionPdf(record.pdfUrl);
        const officialPdfName = new URL(record.pdfUrl).pathname.split("/").pop() ?? "opinion.pdf";
        const stored = await artifactStore.putIfAbsent({
          key: `scotus/slip-opinions/${options.termYear}/${officialPdfName.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-${pdf.contentHash}.pdf`,
          mediaType: pdf.mediaType, body: pdf.body, contentHash: pdf.contentHash,
        });
        const [pdfArtifact] = await sql<{ id: string }[]>`
          INSERT INTO raw_artifact (provider_id, ingestion_run_id, source_uri, source_record_id,
            content_hash, object_key, media_type, retrieved_at, response_metadata)
          VALUES (${provider.id}, ${runId}, ${pdf.sourceUri}, ${record.sourceRecordId},
            ${pdf.contentHash}, ${stored.objectKey}, ${pdf.mediaType}, ${pdf.retrievedAt},
            ${sql.json({ termYear: options.termYear, docketNumber: record.docketNumber,
          sourcePageStart: record.startPage, sourcePageEnd: record.endPage })})
          ON CONFLICT (provider_id, source_uri, content_hash)
          DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
          RETURNING id
        `;
        if (!pdfArtifact) throw new Error("Official Supreme Court PDF artifact was not persisted");
        await sql`
          INSERT INTO official_opinion_candidate (provider_id, term_year, source_record_id,
            release_number, docket_number, case_name, filed_on, author_code, citation,
            source_pdf_uri, source_content_hash, listing_artifact_id, opinion_artifact_id,
            source_page_start, source_page_end)
          VALUES (${provider.id}, ${options.termYear}, ${record.sourceRecordId},
            ${record.releaseNumber}, ${record.docketNumber}, ${record.caseName}, ${record.filedOn},
            ${record.authorCode}, ${record.citation}, ${record.pdfUrl}, ${pdf.contentHash},
            ${listingArtifact.id}, ${pdfArtifact.id}, ${record.startPage}, ${record.endPage})
          ON CONFLICT (provider_id, source_record_id) DO UPDATE SET
            release_number = EXCLUDED.release_number, docket_number = EXCLUDED.docket_number,
            case_name = EXCLUDED.case_name, filed_on = EXCLUDED.filed_on,
            author_code = EXCLUDED.author_code, citation = EXCLUDED.citation,
            source_pdf_uri = EXCLUDED.source_pdf_uri,
            listing_artifact_id = EXCLUDED.listing_artifact_id,
            opinion_artifact_id = EXCLUDED.opinion_artifact_id,
            source_page_start = EXCLUDED.source_page_start,
            source_page_end = EXCLUDED.source_page_end,
            review_status = CASE WHEN official_opinion_candidate.source_content_hash <> EXCLUDED.source_content_hash
              THEN 'pending_review'::ingestion_candidate_status ELSE official_opinion_candidate.review_status END,
            source_content_hash = EXCLUDED.source_content_hash, last_seen_at = now(),
            reviewed_at = CASE WHEN official_opinion_candidate.source_content_hash <> EXCLUDED.source_content_hash
              THEN NULL ELSE official_opinion_candidate.reviewed_at END
        `;
        await finishIngestionRunItem(sql, { runId, sourceRecordId: record.sourceRecordId, documentCount: 1 });
        await sql`
          INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
          VALUES (${provider.id}, ${`official:slip-opinions:${options.termYear}`}, ${record.sourceRecordId})
          ON CONFLICT (provider_id, stream_name) DO UPDATE
          SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
        `;
        succeeded += 1;
      } catch (error) {
        failed += 1;
        await finishIngestionRunItem(sql, { runId, sourceRecordId: record.sourceRecordId,
          error: error instanceof Error ? error.message : "Official opinion ingestion failed" });
        // Do not advance past a failed source record. The next resumed run retries it,
        // while the per-run item remains an immutable failure ledger entry.
        break;
      }
    }
    await finishIngestionRun(sql, runId);
    return {
      runId,
      discovered: index.records.length,
      selected: selected.length,
      succeeded,
      failed,
      checkpoint: succeeded > 0
        ? selected[succeeded - 1]?.sourceRecordId ?? checkpoint?.cursor_value ?? null
        : checkpoint?.cursor_value ?? null,
    };
  } catch (error) {
    await finishIngestionRun(sql, runId, error instanceof Error ? error.message : "Official opinion ingestion failed");
    throw error;
  }
}
