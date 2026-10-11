import type { FederalOpinionChunkResult } from "./import-federal-opinion-chunk";

export interface ClaimedFederalChunk {
  chunkKey: string;
  filePath: string;
  recordCount: number;
  fileSha256: string;
}

export interface FederalChunkImportSummary {
  /** Chunks claimed and tried this run (success OR failure). Bounded by maxChunks. */
  attempted: number;
  completed: number;
  failed: number;
  opinionsWritten: number;
  opinionsSkipped: number;
}

export interface FederalChunkImportProgress extends FederalChunkImportSummary {
  lastChunkKey: string;
  outcome: "completed" | "failed";
}

export interface RunFederalChunkImportDeps {
  /**
   * Claim the next pending ('ready'/'failed') chunk whose key is NOT in excludeKeys,
   * atomically marking it 'importing'. Returns null when none remain. Excluding the
   * keys already tried this run is what stops a permanently-failing chunk from being
   * re-claimed over and over in the same run.
   */
  claimNext: (excludeKeys: readonly string[]) => Promise<ClaimedFederalChunk | null>;
  importChunk: (chunk: ClaimedFederalChunk) => Promise<FederalOpinionChunkResult>;
  markCompleted: (chunk: ClaimedFederalChunk, result: FederalOpinionChunkResult) => Promise<void>;
  markFailed: (chunk: ClaimedFederalChunk, message: string) => Promise<void>;
  onProgress?: (progress: FederalChunkImportProgress) => void;
}

export interface RunFederalChunkImportOptions {
  /** Max chunks to ATTEMPT this run (success or failure both count). Unbounded if unset. */
  maxChunks?: number;
}

/**
 * Drive the ledger-based chunk import with bounded, terminating retries.
 *
 * Two guarantees make this terminate — the bug the first pilot exposed, where a chunk
 * that always fails validation was re-claimed forever:
 *  1. Every ATTEMPT (not just successes) counts toward maxChunks.
 *  2. A chunk tried this run is excluded from further claims this run, so a permanently
 *     invalid chunk is tried at most once per run; it stays 'failed' for a *later* run
 *     to retry (e.g. after a fix), but never spins the current one.
 * Since the claimable set strictly shrinks (each iteration adds a key to the exclude set
 * or maxChunks is hit or claimNext returns null), the loop always terminates.
 */
export async function runFederalChunkImport(
  deps: RunFederalChunkImportDeps,
  options: RunFederalChunkImportOptions = {},
): Promise<FederalChunkImportSummary> {
  const maxChunks = options.maxChunks;
  if (maxChunks !== undefined && (!Number.isInteger(maxChunks) || maxChunks < 1)) {
    throw new Error("maxChunks must be a positive integer");
  }

  const summary: FederalChunkImportSummary = {
    attempted: 0,
    completed: 0,
    failed: 0,
    opinionsWritten: 0,
    opinionsSkipped: 0,
  };
  const attemptedKeys = new Set<string>();

  for (;;) {
    if (maxChunks !== undefined && summary.attempted >= maxChunks) break;

    const chunk = await deps.claimNext([...attemptedKeys]);
    if (!chunk) break;
    // Defensive termination guard: if claimNext ever hands back a key we already tried
    // (e.g. its exclusion predicate regressed), stop rather than spin forever.
    if (attemptedKeys.has(chunk.chunkKey)) break;

    attemptedKeys.add(chunk.chunkKey);
    summary.attempted += 1;

    try {
      const result = await deps.importChunk(chunk);
      await deps.markCompleted(chunk, result);
      summary.completed += 1;
      summary.opinionsWritten += result.opinionsWritten;
      summary.opinionsSkipped += result.opinionsSkippedEmpty + result.opinionsUnmatched;
      deps.onProgress?.({ ...summary, lastChunkKey: chunk.chunkKey, outcome: "completed" });
    } catch (error) {
      await deps.markFailed(chunk, error instanceof Error ? error.message : String(error));
      summary.failed += 1;
      deps.onProgress?.({ ...summary, lastChunkKey: chunk.chunkKey, outcome: "failed" });
    }
  }

  return summary;
}
