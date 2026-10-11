import type { CourtListenerBulkOpinion } from "../providers/courtlistener/bulk-opinions";

export interface FederalOpinionChunkSink {
  /**
   * Persist one chunk's opinions durably (e.g. a JSONL.gz file) and record it in the
   * resume ledger as 'ready'. Returns once the chunk is safe to rely on for resume.
   * MUST be idempotent on chunkIndex so a re-run overwrites a partially-written chunk.
   */
  (chunkIndex: number, records: readonly CourtListenerBulkOpinion[]): Promise<void>;
}

export interface SplitFederalOpinionsOptions {
  /** Opinions per chunk. Smaller = more resumable + more visible; larger = fewer files. */
  chunkSize?: number;
  onProgress?: (progress: { opinionsMatched: number; chunksWritten: number }) => void;
}

export interface SplitFederalOpinionsResult {
  opinionsScanned: number;
  opinionsMatched: number;
  chunksWritten: number;
}

/**
 * Stream the (already-decoded) opinions ONCE and split only the opinions we can
 * actually attach -- those whose cluster was ingested in Phase 1, per
 * `isIngestedCluster` -- into fixed-size chunks, handing each finished chunk to `sink`
 * (which writes it to disk + records it in federal_import_chunk as 'ready'). Opinions
 * for unknown clusters (non-federal, or not yet ingested) are dropped here so chunks
 * stay federal-only and every chunked import is all-hit.
 *
 * This function is pure stream plumbing: the caller owns the (bounded, heap-capped)
 * ingested-cluster membership and the durable sink, which keeps this unit testable
 * without a database and the multi-GB opinion stream is never buffered (only one
 * chunk at a time).
 */
export async function splitFederalOpinions(
  opinions: AsyncIterable<CourtListenerBulkOpinion> | Iterable<CourtListenerBulkOpinion>,
  isIngestedCluster: (clusterId: string) => boolean,
  sink: FederalOpinionChunkSink,
  options: SplitFederalOpinionsOptions = {},
): Promise<SplitFederalOpinionsResult> {
  const chunkSize = options.chunkSize ?? 25_000;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer");
  }

  const result: SplitFederalOpinionsResult = {
    opinionsScanned: 0,
    opinionsMatched: 0,
    chunksWritten: 0,
  };

  let buffer: CourtListenerBulkOpinion[] = [];
  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const chunkIndex = result.chunksWritten;
    const records = buffer;
    buffer = [];
    await sink(chunkIndex, records);
    result.chunksWritten += 1;
    options.onProgress?.({
      opinionsMatched: result.opinionsMatched,
      chunksWritten: result.chunksWritten,
    });
  };

  for await (const opinion of opinions) {
    result.opinionsScanned += 1;
    if (!isIngestedCluster(opinion.cluster_id)) continue;
    result.opinionsMatched += 1;
    buffer.push(opinion);
    if (buffer.length >= chunkSize) await flush();
  }
  await flush();

  return result;
}
