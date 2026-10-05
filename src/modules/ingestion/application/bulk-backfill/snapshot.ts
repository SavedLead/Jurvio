import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export const COURTLISTENER_BULK_BASE_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data";

/** Spaces key prefix the fetch script mirrors each snapshot under (cold tier). */
export function snapshotMirrorKey(snapshotDate: string, fileName: string): string {
  return `courtlistener/bulk-mirror/${snapshotDate}/${fileName}`;
}

export type SnapshotFileKind = "courts" | "dockets" | "opinion-clusters" | "citations" | "opinions";

export interface SnapshotFile {
  kind: SnapshotFileKind;
  fileName: string;
  path: string;
  sha256: string;
  bytes: number;
}

export function snapshotFileName(kind: SnapshotFileKind, snapshotDate: string): string {
  return `${kind}-${snapshotDate}.csv.bz2`;
}

/** Parse a `sha256sum` manifest ("<hex>  <name>" or "<hex> *<name>"). */
export function parseSha256Manifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/i.exec(line.trim());
    if (match) entries.set(path.basename(match[2]!), match[1]!.toLowerCase());
  }
  return entries;
}

/**
 * Resolve the local snapshot files the backfill reads. The loader works from a
 * downloaded, checksummed copy (scripts/fetch-courtlistener-snapshot.sh) rather
 * than streaming from CourtListener: a restart then re-reads local disk instead of
 * re-downloading tens of GB, and every row's provenance points at a file whose
 * SHA-256 is recorded.
 */
export async function resolveSnapshotFiles(
  directory: string,
  snapshotDate: string,
  kinds: readonly SnapshotFileKind[],
): Promise<Map<SnapshotFileKind, SnapshotFile>> {
  let manifestText: string;
  try {
    manifestText = await readFile(path.join(directory, "SHA256SUMS"), "utf8");
  } catch {
    throw new Error(
      `${directory}/SHA256SUMS is missing; fetch the snapshot with scripts/fetch-courtlistener-snapshot.sh first`,
    );
  }
  const manifest = parseSha256Manifest(manifestText);
  const files = new Map<SnapshotFileKind, SnapshotFile>();
  for (const kind of kinds) {
    const fileName = snapshotFileName(kind, snapshotDate);
    const sha256 = manifest.get(fileName);
    if (!sha256) throw new Error(`SHA256SUMS has no entry for ${fileName}`);
    const filePath = path.join(directory, fileName);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new Error(`Snapshot file ${filePath} is missing`);
    files.set(kind, { kind, fileName, path: filePath, sha256, bytes: info.size });
  }
  return files;
}

/**
 * One raw_artifact per snapshot file. Rows loaded from the file point at it, and
 * their provider identifiers (docket/cluster/opinion id) locate the exact row, so
 * provenance no longer costs a raw_artifact row and an object upload per record.
 */
export async function registerSnapshotArtifact(
  sql: Sql,
  input: { providerId: string; snapshotDate: string; file: SnapshotFile; lane: string },
): Promise<string> {
  const { file, snapshotDate } = input;
  const [artifact] = await sql<{ id: string }[]>`
    INSERT INTO raw_artifact (
      provider_id, source_uri, source_record_id, content_hash, object_key,
      media_type, retrieved_at, response_metadata
    ) VALUES (
      ${input.providerId}, ${`${COURTLISTENER_BULK_BASE_URL}/${file.fileName}`},
      ${file.fileName}, ${file.sha256}, ${snapshotMirrorKey(snapshotDate, file.fileName)},
      'application/x-bzip2', ${snapshotDate},
      ${sql.json({
        source: "courtlistener_bulk",
        granularity: "snapshot_file",
        snapshotDate,
        lane: input.lane,
        fileName: file.fileName,
        bytes: file.bytes,
      })}
    )
    ON CONFLICT (provider_id, source_uri, content_hash)
    DO UPDATE SET response_metadata = EXCLUDED.response_metadata
    RETURNING id
  `;
  if (!artifact) throw new Error(`Snapshot artifact for ${file.fileName} was not registered`);
  return artifact.id;
}
