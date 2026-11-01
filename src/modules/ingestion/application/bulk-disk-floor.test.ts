import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BULK_VOLUME_MARKER,
  BULK_VOLUME_STAT_DIR,
  checkBulkDiskFloor,
  evaluateBulkDiskFloor,
} from "./bulk-disk-floor";

const GB = 1024 ** 3;
const disk = (totalGb: number, freeGb: number) => ({ blocks: (totalGb * GB) / 4096, bavail: (freeGb * GB) / 4096, bsize: 4096 });

describe("evaluateBulkDiskFloor", () => {
  it("keeps the 30% root floor when there is no volume", () => {
    expect(evaluateBulkDiskFloor(disk(309, 100), null)).toMatchObject({ ok: true, volumeCounted: false });
    expect(evaluateBulkDiskFloor(disk(309, 90), null)).toMatchObject({ ok: false, volumeCounted: false });
    expect(evaluateBulkDiskFloor(null, disk(246, 246)).ok).toBe(false);
  });

  it("counts the volume: root under 30% is fine while combined free stays over 30%", () => {
    const result = evaluateBulkDiskFloor(disk(309, 80), disk(246, 200));
    expect(result.ok).toBe(true);
    expect(result.volumeCounted).toBe(true);
    expect(result.freeDiskRatio).toBeCloseTo(280 / 555, 3);
  });

  it("still stops when root alone drops under 15%", () => {
    expect(evaluateBulkDiskFloor(disk(309, 40), disk(246, 240)).ok).toBe(false);
  });

  it("stops when the volume alone drops under 10%", () => {
    expect(evaluateBulkDiskFloor(disk(309, 250), disk(246, 20)).ok).toBe(false);
  });

  it("stops when combined free drops under 30%", () => {
    expect(evaluateBulkDiskFloor(disk(309, 60), disk(246, 100)).ok).toBe(false);
  });
});

describe("checkBulkDiskFloor", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("ignores the volume stat dir unless its marker file is there", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "bulk-floor-"));
    await mkdir(path.join(dir, BULK_VOLUME_STAT_DIR));
    expect((await checkBulkDiskFloor(dir)).volumeCounted).toBe(false);
    await writeFile(path.join(dir, BULK_VOLUME_STAT_DIR, BULK_VOLUME_MARKER), "x");
    const result = await checkBulkDiskFloor(dir);
    expect(result.volumeCounted).toBe(true);
    expect(result.rootFreeRatio).not.toBeNull();
  });
});
