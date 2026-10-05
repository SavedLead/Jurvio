import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import {
  bulkContentHash,
  bulkOpinionPlainText,
  bulkOpinionWordCount,
  normalizeBulkOpinionType,
  type CourtListenerBulkOpinion,
} from "../../providers/courtlistener/bulk-opinions";
import { bulkOpinionMetadata, cleanOptionalText, cleanText } from "./bulk-values";
import type { BatchOutcome } from "./stage-runner";

export interface OpinionBatchRow {
  opinion_id: string;
  cluster_id: string;
  document_public_id: string;
  opinion_type: string;
  author_name: string | null;
  per_curiam: boolean;
  download_url: string | null;
  content_html: string;
  content_text: string;
  content_hash: string;
  extraction_method: string;
  word_count: number;
  provider_metadata: Record<string, unknown>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * The opinion's text in the same shape the per-row loader stored (one chosen
 * rendering, HTML synthesized from plain text when that is all there is), or null
 * when the opinion has no text at all.
 */
export function opinionBatchRow(opinion: CourtListenerBulkOpinion): OpinionBatchRow | null {
  const extracted = bulkOpinionPlainText(opinion);
  const contentText = cleanText(extracted.text).trim();
  if (!contentText) return null;
  const contentHtml = extracted.html ? cleanText(extracted.html) : `<p>${escapeHtml(contentText)}</p>`;
  return {
    opinion_id: opinion.id,
    cluster_id: opinion.cluster_id,
    document_public_id: createPublicId("document"),
    opinion_type: normalizeBulkOpinionType(opinion.type),
    author_name: cleanOptionalText(opinion.author_str),
    per_curiam: opinion.per_curiam ?? false,
    download_url: cleanOptionalText(opinion.download_url),
    content_html: contentHtml,
    content_text: contentText,
    content_hash: bulkContentHash(contentHtml),
    extraction_method: extracted.method,
    word_count: bulkOpinionWordCount(contentText),
    provider_metadata: bulkOpinionMetadata(opinion as Record<string, unknown>),
  };
}

export function opinionRowBytes(row: OpinionBatchRow): number {
  return row.content_html.length + row.content_text.length + 1_000;
}

/**
 * Merge one batch of opinions into document, judicial_opinion,
 * document_identifier, document_content and opinion_search_projection.
 *
 * Opinions attach to clusters loaded in the clusters stage; others drop out.
 * Bulk writes or refreshes an opinion only when it has no content yet or its
 * content came from a bulk load: content from the live API (and the provenance the
 * publication checks rely on) is never replaced. Unchanged rows are skipped, so a
 * rerun or next-snapshot refresh rewrites only what changed. No per-document
 * publication review is queued; publication lanes select drafts directly.
 */
export async function mergeOpinionBatch(
  tx: postgres.TransactionSql,
  context: { providerId: string; artifactId: string },
  rows: readonly OpinionBatchRow[],
): Promise<BatchOutcome & { created: number; keptOtherSource: number }> {
  const unique = [...new Map(rows.map((row) => [row.opinion_id, row])).values()];
  await tx`
    CREATE TEMP TABLE IF NOT EXISTS bulk_opinion_batch (
      opinion_id text PRIMARY KEY,
      cluster_id text NOT NULL,
      document_public_id text NOT NULL,
      opinion_type text NOT NULL,
      author_name text,
      per_curiam boolean NOT NULL,
      download_url text,
      content_html text NOT NULL,
      content_text text NOT NULL,
      content_hash text NOT NULL,
      extraction_method text NOT NULL,
      word_count integer NOT NULL,
      provider_metadata jsonb NOT NULL,
      cluster_internal_id uuid,
      case_id uuid,
      court_id uuid,
      court_name text,
      case_name text,
      date_filed date,
      precedential_status text,
      citation_count integer,
      title text,
      document_id uuid,
      created boolean NOT NULL DEFAULT false,
      bulk_owned boolean NOT NULL DEFAULT true
    ) ON COMMIT DELETE ROWS
  `;
  await tx`
    INSERT INTO bulk_opinion_batch (
      opinion_id, cluster_id, document_public_id, opinion_type, author_name,
      per_curiam, download_url, content_html, content_text, content_hash,
      extraction_method, word_count, provider_metadata
    )
    SELECT opinion_id, cluster_id, document_public_id, opinion_type, author_name,
      per_curiam, download_url, content_html, content_text, content_hash,
      extraction_method, word_count, provider_metadata
    FROM jsonb_to_recordset(${tx.json(unique as unknown as postgres.JSONValue)}) AS r(
      opinion_id text, cluster_id text, document_public_id text, opinion_type text,
      author_name text, per_curiam boolean, download_url text, content_html text,
      content_text text, content_hash text, extraction_method text, word_count integer,
      provider_metadata jsonb
    )
  `;
  await tx`
    UPDATE bulk_opinion_batch b SET
      cluster_internal_id = cluster.id,
      case_id = cluster.case_id,
      case_name = cluster.case_name,
      date_filed = cluster.date_filed,
      precedential_status = cluster.precedential_status,
      citation_count = cluster.citation_count,
      title = cluster.case_name || ' — ' || b.opinion_type
    FROM opinion_cluster cluster
    WHERE cluster.provider_id = ${context.providerId}
      AND cluster.provider_cluster_id = b.cluster_id
  `;
  await tx`DELETE FROM bulk_opinion_batch WHERE cluster_internal_id IS NULL`;
  await tx`
    UPDATE bulk_opinion_batch b SET
      court_id = legal_case.court_id,
      court_name = upper(coalesce(court.provider_court_id, court.short_name, court.name))
    FROM legal_case JOIN court ON court.id = legal_case.court_id
    WHERE legal_case.id = b.case_id
  `;
  await tx`
    UPDATE bulk_opinion_batch b SET document_id = judicial.document_id
    FROM judicial_opinion judicial
    WHERE judicial.provider_id = ${context.providerId}
      AND judicial.provider_opinion_id = b.opinion_id
  `;
  await tx`
    UPDATE bulk_opinion_batch b SET bulk_owned = false
    WHERE EXISTS (
      SELECT 1 FROM document_content content
      JOIN raw_artifact artifact ON artifact.id = content.source_artifact_id
      WHERE content.document_id = b.document_id
        AND coalesce(artifact.response_metadata->>'source', '') <> 'courtlistener_bulk'
    )
  `;
  const [owned] = await tx<{ matched: number; kept: number }[]>`
    SELECT count(*)::int AS matched, count(*) FILTER (WHERE NOT bulk_owned)::int AS kept
    FROM bulk_opinion_batch
  `;
  await tx`DELETE FROM bulk_opinion_batch WHERE NOT bulk_owned`;
  await tx`
    WITH created AS (
      INSERT INTO document (
        public_id, case_id, document_type, title, filed_on, content_hash,
        source_artifact_id, publication, extraction_confidence
      )
      SELECT document_public_id, case_id, 'judicial_opinion', title, date_filed,
        content_hash, ${context.artifactId}::uuid, 'draft', 1.000
      FROM bulk_opinion_batch
      WHERE document_id IS NULL
      RETURNING id, public_id
    )
    UPDATE bulk_opinion_batch b SET document_id = created.id, created = true
    FROM created
    WHERE b.document_public_id = created.public_id
  `;
  await tx`
    UPDATE document SET
      case_id = b.case_id, title = b.title, filed_on = b.date_filed,
      content_hash = b.content_hash, source_artifact_id = ${context.artifactId}::uuid,
      extraction_confidence = 1.000, updated_at = now()
    FROM bulk_opinion_batch b
    WHERE document.id = b.document_id AND NOT b.created
      AND (document.case_id, document.title, document.filed_on, document.content_hash,
        document.source_artifact_id)
        IS DISTINCT FROM (b.case_id, b.title, b.date_filed, b.content_hash,
        ${context.artifactId}::uuid)
  `;
  await tx`
    INSERT INTO judicial_opinion (
      cluster_id, document_id, provider_id, provider_opinion_id, opinion_type,
      author_name, per_curiam, source_download_url, source_artifact_id, provider_metadata
    )
    SELECT cluster_internal_id, document_id, ${context.providerId}, opinion_id, opinion_type,
      author_name, per_curiam, download_url, ${context.artifactId}::uuid, provider_metadata
    FROM bulk_opinion_batch
    ON CONFLICT (provider_id, provider_opinion_id)
    DO UPDATE SET
      cluster_id = EXCLUDED.cluster_id, document_id = EXCLUDED.document_id,
      opinion_type = EXCLUDED.opinion_type, author_name = EXCLUDED.author_name,
      per_curiam = EXCLUDED.per_curiam,
      source_download_url = EXCLUDED.source_download_url,
      source_artifact_id = EXCLUDED.source_artifact_id,
      provider_metadata = EXCLUDED.provider_metadata, updated_at = now()
    WHERE (
        judicial_opinion.cluster_id, judicial_opinion.document_id,
        judicial_opinion.opinion_type, judicial_opinion.author_name,
        judicial_opinion.per_curiam, judicial_opinion.source_download_url,
        judicial_opinion.source_artifact_id, judicial_opinion.provider_metadata
      ) IS DISTINCT FROM (
        EXCLUDED.cluster_id, EXCLUDED.document_id, EXCLUDED.opinion_type,
        EXCLUDED.author_name, EXCLUDED.per_curiam, EXCLUDED.source_download_url,
        EXCLUDED.source_artifact_id, EXCLUDED.provider_metadata
      )
  `;
  await tx`
    INSERT INTO document_identifier (document_id, provider_id, identifier_type, identifier_value)
    SELECT document_id, ${context.providerId}, 'courtlistener_opinion_id', opinion_id
    FROM bulk_opinion_batch
    ON CONFLICT (provider_id, identifier_type, identifier_value)
    DO UPDATE SET document_id = EXCLUDED.document_id
    WHERE document_identifier.document_id IS DISTINCT FROM EXCLUDED.document_id
  `;
  const content = await tx`
    INSERT INTO document_content (
      document_id, content_html, content_text, content_hash, extraction_method,
      word_count, source_artifact_id
    )
    SELECT document_id, content_html, content_text, content_hash, extraction_method,
      word_count, ${context.artifactId}::uuid
    FROM bulk_opinion_batch
    ON CONFLICT (document_id)
    DO UPDATE SET
      content_html = EXCLUDED.content_html, content_text = EXCLUDED.content_text,
      content_hash = EXCLUDED.content_hash,
      extraction_method = EXCLUDED.extraction_method,
      word_count = EXCLUDED.word_count,
      source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
    WHERE (
        document_content.content_hash, document_content.extraction_method,
        document_content.source_artifact_id
      ) IS DISTINCT FROM (
        EXCLUDED.content_hash, EXCLUDED.extraction_method, EXCLUDED.source_artifact_id
      )
  `;
  await tx`
    INSERT INTO opinion_search_projection (
      document_id, case_id, court_id, cluster_id, title, case_caption, court_name,
      date_filed, precedential_status, opinion_type, citation_count, body
    )
    SELECT document_id, case_id, court_id, cluster_internal_id, title, case_name,
      court_name, date_filed, precedential_status, opinion_type, citation_count,
      content_text
    FROM bulk_opinion_batch
    ON CONFLICT (document_id)
    DO UPDATE SET
      case_id = EXCLUDED.case_id, court_id = EXCLUDED.court_id,
      cluster_id = EXCLUDED.cluster_id, title = EXCLUDED.title,
      case_caption = EXCLUDED.case_caption, court_name = EXCLUDED.court_name,
      date_filed = EXCLUDED.date_filed,
      precedential_status = EXCLUDED.precedential_status,
      opinion_type = EXCLUDED.opinion_type,
      citation_count = EXCLUDED.citation_count, body = EXCLUDED.body,
      updated_at = now()
    WHERE (
        opinion_search_projection.case_id, opinion_search_projection.court_id,
        opinion_search_projection.cluster_id, opinion_search_projection.title,
        opinion_search_projection.case_caption, opinion_search_projection.court_name,
        opinion_search_projection.date_filed, opinion_search_projection.precedential_status,
        opinion_search_projection.opinion_type, opinion_search_projection.citation_count,
        opinion_search_projection.body
      ) IS DISTINCT FROM (
        EXCLUDED.case_id, EXCLUDED.court_id, EXCLUDED.cluster_id, EXCLUDED.title,
        EXCLUDED.case_caption, EXCLUDED.court_name, EXCLUDED.date_filed,
        EXCLUDED.precedential_status, EXCLUDED.opinion_type, EXCLUDED.citation_count,
        EXCLUDED.body
      )
  `;
  const [summary] = await tx<{ created: number }[]>`
    SELECT count(*) FILTER (WHERE created)::int AS created FROM bulk_opinion_batch
  `;
  return {
    matched: owned?.matched ?? 0,
    written: content.count,
    created: summary?.created ?? 0,
    keptOtherSource: owned?.kept ?? 0,
  };
}
