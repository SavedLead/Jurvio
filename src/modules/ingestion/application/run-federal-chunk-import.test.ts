import { describe, expect, it } from "vitest";
import {
  runFederalChunkImport,
  type ClaimedFederalChunk,
  type RunFederalChunkImportDeps,
} from "./run-federal-chunk-import";

function chunk(index: number): ClaimedFederalChunk {
  const key = `2026-09-30/${String(index).padStart(6, "0")}`;
  return { chunkKey: key, filePath: `/chunks/${key}.jsonl.gz`, recordCount: 1000, fileSha256: "x" };
}

/** A fake ledger: a fixed pool of pending chunks, claimed in order, honouring excludeKeys. */
function fakeLedger(pool: ClaimedFederalChunk[]) {
  const completed = new Set<string>();
  const failed = new Set<string>();
  let claims = 0;
  const deps = (
    importChunk: RunFederalChunkImportDeps["importChunk"],
  ): RunFederalChunkImportDeps => ({
    claimNext: async (excludeKeys) => {
      claims += 1;
      const next = pool.find(
        (c) => !excludeKeys.includes(c.chunkKey) && !completed.has(c.chunkKey),
      );
      return next ?? null;
    },
    importChunk,
    markCompleted: async (c) => void completed.add(c.chunkKey),
    markFailed: async (c) => void failed.add(c.chunkKey),
  });
  return { deps, completed, failed, get claims() { return claims; } };
}

describe("runFederalChunkImport", () => {
  it("terminates within maxChunks when every chunk fails permanently (no infinite re-claim)", async () => {
    const ledger = fakeLedger([chunk(0), chunk(1), chunk(2), chunk(3), chunk(4), chunk(5)]);
    const summary = await runFederalChunkImport(
      ledger.deps(async () => {
        throw new Error("invalid chunk: schema mismatch");
      }),
      { maxChunks: 3 },
    );
    expect(summary.attempted).toBe(3); // capped, did NOT spin over all 6
    expect(summary.failed).toBe(3);
    expect(summary.completed).toBe(0);
  });

  it("terminates when the pool is exhausted even with no maxChunks (failed chunk not re-claimed this run)", async () => {
    const ledger = fakeLedger([chunk(0), chunk(1)]);
    const summary = await runFederalChunkImport(
      ledger.deps(async () => {
        throw new Error("invalid chunk");
      }),
      {},
    );
    // Each of the 2 chunks is attempted exactly once, then claimNext returns null.
    expect(summary.attempted).toBe(2);
    expect(summary.failed).toBe(2);
  });

  it("counts inserts/updates path, skips, and stops at maxChunks on success", async () => {
    const ledger = fakeLedger([chunk(0), chunk(1), chunk(2)]);
    const summary = await runFederalChunkImport(
      ledger.deps(async () => ({
        opinionsWritten: 900,
        opinionsSkippedEmpty: 50,
        opinionsUnmatched: 50,
      })),
      { maxChunks: 2 },
    );
    expect(summary.attempted).toBe(2);
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.opinionsWritten).toBe(1800);
    expect(summary.opinionsSkipped).toBe(200); // (50 empty + 50 unmatched) * 2
    expect(ledger.completed.size).toBe(2);
  });

  it("rejects an invalid maxChunks", async () => {
    const ledger = fakeLedger([chunk(0)]);
    await expect(
      runFederalChunkImport(ledger.deps(async () => ({ opinionsWritten: 0, opinionsSkippedEmpty: 0, opinionsUnmatched: 0 })), {
        maxChunks: 0,
      }),
    ).rejects.toThrow(/maxChunks/);
  });
});
