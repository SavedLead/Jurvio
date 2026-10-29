/**
 * CourtListener opinion chunks were first written to `/var/lib/jurvio/federal-chunks`,
 * which is the worker container's writable layer, not the artifacts volume. Recreating
 * worker-core (deploy or the lane watchdog) deletes those files while the Postgres
 * ledger still says `ready`. The durable location is on the artifacts volume, which
 * every app/worker container already mounts.
 */
export const LEGACY_FEDERAL_CHUNK_ROOT = "/var/lib/jurvio/federal-chunks";
export const DURABLE_FEDERAL_CHUNK_ROOT = "/var/lib/jurvio/artifacts/federal-chunks";

function alternateChunkPath(recordedPath: string): string | null {
  if (recordedPath.startsWith(`${LEGACY_FEDERAL_CHUNK_ROOT}/`)) {
    return DURABLE_FEDERAL_CHUNK_ROOT + recordedPath.slice(LEGACY_FEDERAL_CHUNK_ROOT.length);
  }
  if (recordedPath.startsWith(`${DURABLE_FEDERAL_CHUNK_ROOT}/`)) {
    return LEGACY_FEDERAL_CHUNK_ROOT + recordedPath.slice(DURABLE_FEDERAL_CHUNK_ROOT.length);
  }
  return null;
}

/**
 * Resolve a ledger path to a file that actually exists. Checks the recorded path
 * and the legacy/durable twin so an in-flight import keeps working across the
 * path move. Returns null when neither copy is on disk — the caller must not
 * claim the chunk in that case.
 */
export function resolveFederalChunkFile(
  recordedPath: string,
  exists: (path: string) => boolean,
): string | null {
  if (exists(recordedPath)) return recordedPath;
  const alternate = alternateChunkPath(recordedPath);
  if (alternate && exists(alternate)) return alternate;
  return null;
}

/**
 * True when there is nothing queued, or at least one sampled chunk file is readable.
 * When every sampled file is missing, the corpus was wiped with a container recreate
 * and claiming chunks would only stamp them `failed`.
 */
export function federalChunkCorpusIsReadable(
  recordedPaths: readonly string[],
  exists: (path: string) => boolean,
): boolean {
  if (recordedPaths.length === 0) return true;
  return recordedPaths.some((path) => resolveFederalChunkFile(path, exists) !== null);
}
