import { access, statfs } from "node:fs/promises";
import path from "node:path";

/**
 * Free-disk floor for the bulk CourtListener loaders.
 *
 * Without the Postgres bulk volume this is the original rule: stop when the root
 * disk (seen through the artifacts path) has under 30% free.
 *
 * With the bulk volume (a DigitalOcean block volume that holds the jurvio_bulk
 * tablespace, see .github/workflows/pg-bulk-volume-once.yml), the loaders write to
 * both disks, so the floor counts both:
 *   - combined free space of root + volume must stay at or above 30%, and
 *   - the root disk alone must keep at least 15% free (WAL, temp files, images,
 *     the cached snapshot), and
 *   - the volume alone must keep at least 10% free.
 *
 * The volume is visible inside the app container as a small read-only bind of
 * <volume>/meta under the artifacts volume. It only counts when its marker file is
 * present, so an unmounted (empty) directory on the root disk is never counted twice.
 */
export const BULK_DISK_FLOOR = 0.3;
export const BULK_ROOT_FLOOR_WITH_VOLUME = 0.15;
export const BULK_VOLUME_FLOOR = 0.1;
export const BULK_VOLUME_MARKER = ".jurvio-pgbulk-volume";
export const BULK_VOLUME_STAT_DIR = ".pgbulk-volume";

export interface DiskSample {
  blocks: number;
  bavail: number;
  bsize: number;
}

export interface DiskFloorResult {
  ok: boolean;
  /** Ratio the floor is judged on: combined when the volume counts, else root. */
  freeDiskRatio: number | null;
  rootFreeRatio: number | null;
  volumeFreeRatio: number | null;
  volumeCounted: boolean;
}

function ratio(sample: DiskSample): number {
  if (!Number.isFinite(sample.blocks) || sample.blocks <= 0) return 0;
  return sample.bavail / sample.blocks;
}

function bytes(blocks: number, bsize: number): number {
  return blocks * (Number.isFinite(bsize) && bsize > 0 ? bsize : 1);
}

export function evaluateBulkDiskFloor(root: DiskSample | null, volume: DiskSample | null): DiskFloorResult {
  if (!root) return { ok: false, freeDiskRatio: null, rootFreeRatio: null, volumeFreeRatio: null, volumeCounted: false };
  const rootFree = ratio(root);
  if (!volume || volume.blocks <= 0) {
    return { ok: rootFree >= BULK_DISK_FLOOR, freeDiskRatio: rootFree, rootFreeRatio: rootFree, volumeFreeRatio: null, volumeCounted: false };
  }
  const volumeFree = ratio(volume);
  const total = bytes(root.blocks, root.bsize) + bytes(volume.blocks, volume.bsize);
  const avail = bytes(root.bavail, root.bsize) + bytes(volume.bavail, volume.bsize);
  const combined = total > 0 ? avail / total : 0;
  return {
    ok: combined >= BULK_DISK_FLOOR && rootFree >= BULK_ROOT_FLOOR_WITH_VOLUME && volumeFree >= BULK_VOLUME_FLOOR,
    freeDiskRatio: combined,
    rootFreeRatio: rootFree,
    volumeFreeRatio: volumeFree,
    volumeCounted: true,
  };
}

/** Where the volume's stat dir appears for a loader whose --disk-path is the artifacts dir. */
export function bulkVolumeStatPath(diskPath: string): string {
  return process.env.JURVIO_BULK_VOLUME_STAT_PATH || path.join(diskPath, BULK_VOLUME_STAT_DIR);
}

async function sample(dir: string): Promise<DiskSample | null> {
  const disk = await statfs(dir).catch(() => null);
  return disk ? { blocks: Number(disk.blocks), bavail: Number(disk.bavail), bsize: Number(disk.bsize) } : null;
}

export async function checkBulkDiskFloor(diskPath: string): Promise<DiskFloorResult> {
  const root = await sample(diskPath);
  const volumeDir = bulkVolumeStatPath(diskPath);
  const hasMarker = await access(path.join(volumeDir, BULK_VOLUME_MARKER)).then(() => true, () => false);
  const volume = hasMarker ? await sample(volumeDir) : null;
  return evaluateBulkDiskFloor(root, volume);
}
