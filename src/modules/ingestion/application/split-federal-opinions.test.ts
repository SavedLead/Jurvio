import { describe, expect, it } from "vitest";
import { splitFederalOpinions } from "./split-federal-opinions";
import type { CourtListenerBulkOpinion } from "../providers/courtlistener/bulk-opinions";

function op(id: string, clusterId: string): CourtListenerBulkOpinion {
  // The splitter only reads id/cluster_id; cast a minimal object as the row type.
  return { id, cluster_id: clusterId } as unknown as CourtListenerBulkOpinion;
}

describe("splitFederalOpinions", () => {
  it("keeps only ingested-cluster opinions and batches them into fixed-size chunks", async () => {
    const ingested = new Set(["100", "200", "300"]);
    const opinions = [
      op("1", "100"), // keep
      op("2", "999"), // drop (unknown cluster)
      op("3", "200"), // keep
      op("4", "300"), // keep
      op("5", "888"), // drop
      op("6", "100"), // keep  -> 4 kept total
    ];
    const chunks: string[][] = [];
    const result = await splitFederalOpinions(
      opinions,
      (clusterId) => ingested.has(clusterId),
      async (chunkIndex, records) => {
        chunks[chunkIndex] = records.map((r) => r.id);
      },
      { chunkSize: 2 },
    );

    expect(result.opinionsScanned).toBe(6);
    expect(result.opinionsMatched).toBe(4);
    expect(result.chunksWritten).toBe(2);
    // Matched ids 1,3,4,6 -> two chunks of two, in stream order.
    expect(chunks).toEqual([["1", "3"], ["4", "6"]]);
  });

  it("flushes a final partial chunk", async () => {
    const chunks: number[] = [];
    const result = await splitFederalOpinions(
      [op("1", "a"), op("2", "a"), op("3", "a")],
      () => true,
      async (_i, records) => {
        chunks.push(records.length);
      },
      { chunkSize: 2 },
    );
    expect(result.chunksWritten).toBe(2);
    expect(chunks).toEqual([2, 1]); // full chunk, then the partial remainder
  });

  it("writes no chunk when nothing matches", async () => {
    let sinkCalls = 0;
    const result = await splitFederalOpinions(
      [op("1", "x"), op("2", "y")],
      () => false,
      async () => {
        sinkCalls += 1;
      },
      { chunkSize: 5 },
    );
    expect(result.opinionsMatched).toBe(0);
    expect(result.chunksWritten).toBe(0);
    expect(sinkCalls).toBe(0);
  });

  it("rejects an invalid chunk size", async () => {
    await expect(
      splitFederalOpinions([], () => true, async () => {}, { chunkSize: 0 }),
    ).rejects.toThrow(/chunkSize/);
  });
});
