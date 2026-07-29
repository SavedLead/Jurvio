import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type postgres from "postgres";
import type { ArtifactStore } from "./artifact-store";
import { finishIngestionRun, finishIngestionRunItem, startIngestionRun, startIngestionRunItem } from "./ingestion-run";
import { fetchOfficialBoundVolume, fetchOfficialBoundVolumeIndex, parseOfficialBoundVolumeText } from "../providers/scotus/official-bound-volumes";

type Sql = ReturnType<typeof postgres>;
const execFileAsync = promisify(execFile);

export async function ingestOfficialScotusBoundVolume(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: { volume: number; limit: number; resume: boolean },
) {
  if (!Number.isInteger(options.volume) || options.volume < 2 || options.volume > 587) throw new Error("Unsupported U.S. Reports volume");
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error("Batch limit must be between 1 and 100");
  const index = await fetchOfficialBoundVolumeIndex();
  const source = index.volumes.find((item) => item.volume === options.volume);
  if (!source) throw new Error(`Official U.S. Reports volume ${options.volume} is not listed by the Supreme Court`);
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'scotus_official'`;
  if (!provider) throw new Error("Official Supreme Court provider seed is missing");
  const streamName = `official:bound-volume:${options.volume}`;
  const [checkpoint] = options.resume ? await sql<{ cursor_value: string }[]>`
    SELECT cursor_value FROM ingestion_checkpoint WHERE provider_id = ${provider.id} AND stream_name = ${streamName}
  ` : [];
  const volume = await fetchOfficialBoundVolume(source);
  const directory = await mkdtemp(path.join(tmpdir(), `jurvio-usreports-${options.volume}-`));
  let text: string;
  try {
    const pdfPath = path.join(directory, `${options.volume}.pdf`);
    const textPath = path.join(directory, `${options.volume}.txt`);
    await writeFile(pdfPath, volume.body);
    await execFileAsync("pdftotext", ["-layout", pdfPath, textPath], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    text = await readFile(textPath, "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const records = parseOfficialBoundVolumeText(text, source);
  const checkpointIndex = checkpoint ? records.findIndex((record) => record.sourceRecordId === checkpoint.cursor_value) : -1;
  if (checkpoint && checkpointIndex < 0) throw new Error("Stored bound-volume checkpoint is absent from the current official volume");
  const selected = records.slice(checkpointIndex + 1, checkpointIndex + 1 + options.limit);
  const runId = await startIngestionRun(sql, {
    providerCode: "scotus_official", runType: "official_scotus_bound_volume",
    selection: { volume: options.volume, termYear: source.termYear, limit: options.limit,
      sourceUri: source.pdfUrl, checkpoint: checkpoint?.cursor_value ?? null }, selectedCount: selected.length,
  });
  try {
    const indexStored = await artifactStore.putIfAbsent({ key: `scotus/us-reports/index-${index.contentHash}.html`,
      mediaType: "text/html", body: index.rawBody, contentHash: index.contentHash });
    const [indexArtifact] = await sql<{ id: string }[]>`
      INSERT INTO raw_artifact (provider_id, ingestion_run_id, source_uri, source_record_id,
        content_hash, object_key, media_type, retrieved_at, response_metadata)
      VALUES (${provider.id}, ${runId}, ${index.sourceUri}, 'us-reports:index', ${index.contentHash},
        ${indexStored.objectKey}, 'text/html', ${index.retrievedAt}, ${sql.json({ volumeCount: index.volumes.length })})
      ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at RETURNING id
    `;
    const volumeStored = await artifactStore.putIfAbsent({ key: `scotus/us-reports/${options.volume}/${options.volume}-${volume.contentHash}.pdf`,
      mediaType: volume.mediaType, body: volume.body, contentHash: volume.contentHash });
    const [volumeArtifact] = await sql<{ id: string }[]>`
      INSERT INTO raw_artifact (provider_id, ingestion_run_id, source_uri, source_record_id,
        content_hash, object_key, media_type, retrieved_at, response_metadata)
      VALUES (${provider.id}, ${runId}, ${source.pdfUrl}, ${`us-reports:${options.volume}`}, ${volume.contentHash},
        ${volumeStored.objectKey}, ${volume.mediaType}, ${volume.retrievedAt},
        ${sql.json({ volume: options.volume, termYear: source.termYear, opinionCount: records.length })})
      ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at RETURNING id
    `;
    if (!indexArtifact || !volumeArtifact) throw new Error("Official bound-volume artifacts were not persisted");
    let succeeded = 0;
    let failed = 0;
    const failures: Array<{ sourceRecordId: string; reason: string }> = [];
    for (const record of selected) {
      await startIngestionRunItem(sql, runId, record.sourceRecordId);
      try {
        await sql`
          INSERT INTO official_opinion_candidate (provider_id, term_year, source_record_id,
            release_number, docket_number, case_name, filed_on, author_code, citation,
            source_pdf_uri, source_content_hash, listing_artifact_id, opinion_artifact_id,
            source_page_start, source_page_end)
          VALUES (${provider.id}, ${source.termYear}, ${record.sourceRecordId}, NULL, ${record.docketNumber},
            ${record.caseName}, ${record.filedOn}, NULL, ${record.citation}, ${record.pdfUrl}, ${volume.contentHash},
            ${indexArtifact.id}, ${volumeArtifact.id}, ${record.startPage}, ${record.endPage})
          ON CONFLICT (provider_id, source_record_id) DO UPDATE SET
            docket_number = EXCLUDED.docket_number, case_name = EXCLUDED.case_name,
            filed_on = EXCLUDED.filed_on, citation = EXCLUDED.citation,
            source_pdf_uri = EXCLUDED.source_pdf_uri, source_content_hash = EXCLUDED.source_content_hash,
            listing_artifact_id = EXCLUDED.listing_artifact_id, opinion_artifact_id = EXCLUDED.opinion_artifact_id,
            source_page_start = EXCLUDED.source_page_start, source_page_end = EXCLUDED.source_page_end,
            review_status = CASE WHEN (
              official_opinion_candidate.docket_number,
              official_opinion_candidate.case_name,
              official_opinion_candidate.filed_on,
              official_opinion_candidate.citation
            ) IS DISTINCT FROM (
              EXCLUDED.docket_number, EXCLUDED.case_name, EXCLUDED.filed_on, EXCLUDED.citation
            ) THEN 'pending_review' ELSE official_opinion_candidate.review_status END,
            reviewed_at = CASE WHEN (
              official_opinion_candidate.docket_number,
              official_opinion_candidate.case_name,
              official_opinion_candidate.filed_on,
              official_opinion_candidate.citation
            ) IS DISTINCT FROM (
              EXCLUDED.docket_number, EXCLUDED.case_name, EXCLUDED.filed_on, EXCLUDED.citation
            ) THEN NULL ELSE official_opinion_candidate.reviewed_at END,
            reviewer_notes = CASE WHEN (
              official_opinion_candidate.docket_number,
              official_opinion_candidate.case_name,
              official_opinion_candidate.filed_on,
              official_opinion_candidate.citation
            ) IS DISTINCT FROM (
              EXCLUDED.docket_number, EXCLUDED.case_name, EXCLUDED.filed_on, EXCLUDED.citation
            ) THEN 'Authoritative bound-volume metadata changed; deterministic republication required.'
              ELSE official_opinion_candidate.reviewer_notes END,
            last_seen_at = now()
        `;
        await finishIngestionRunItem(sql, { runId, sourceRecordId: record.sourceRecordId, documentCount: 1 });
        await sql`
          INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
          VALUES (${provider.id}, ${streamName}, ${record.sourceRecordId})
          ON CONFLICT (provider_id, stream_name) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
        `;
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : "Bound-volume ingestion failed";
        failures.push({ sourceRecordId: record.sourceRecordId, reason });
        await finishIngestionRunItem(sql, { runId, sourceRecordId: record.sourceRecordId, error: reason });
        break;
      }
    }
    await finishIngestionRun(sql, runId);
    return { runId, volume: options.volume, termYear: source.termYear, discovered: records.length,
      selected: selected.length, succeeded, failed, failures,
      checkpoint: succeeded ? selected[succeeded - 1]?.sourceRecordId ?? null : checkpoint?.cursor_value ?? null };
  } catch (error) {
    await finishIngestionRun(sql, runId, error instanceof Error ? error.message : "Bound-volume ingestion failed");
    throw error;
  }
}
