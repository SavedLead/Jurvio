import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { IdCollector, parseId, scanOpinionClusterIds, SortedIdSet } from "./courtlistener-citation-map";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe("CourtListener citation map helpers", () => {
  it("keeps a sorted, de-duplicated id set", () => {
    const collector = new IdCollector();
    for (const id of [9, 3, 3, 7, 0, -1, 70_000_001, 1]) collector.push(id);
    const set = collector.toSet();
    expect(Array.from(set.ids)).toEqual([1, 3, 7, 9, 70_000_001]);
    expect([1, 2, 3, 9, 70_000_001, 10].map((id) => set.has(id))).toEqual([true, false, true, true, true, false]);
    expect(new SortedIdSet([]).has(1)).toBe(false);
  });

  it("parses only positive int32 ids", () => {
    expect(["12", "0", "", "01", "x", "2147483648", "2147483647"].map((value) => parseId(value)))
      .toEqual([12, null, null, null, null, null, 2_147_483_647]);
  });

  it("scans id and cluster_id out of opinions rows with quoted HTML, escapes and chunk splits", async () => {
    const csv = [
      '"id","created","html_with_citations","plain_text","cluster_id"',
      '11,"2020-01-01","<p class=\\"x\\">a, b\nc</p>","text, with \\\\ backslash",101',
      '12,"2020-01-02","","line1\nline2,\\"q\\"",102\r',
      '13,"","","",',
      '14,"","","",104',
    ].join("\n");
    // Split into odd-sized chunks so tokens straddle chunk boundaries.
    const chunks: string[] = [];
    for (let index = 0; index < csv.length; index += 7) chunks.push(csv.slice(index, index + 7));
    expect(await collect(scanOpinionClusterIds(Readable.from(chunks)))).toEqual([[11, 101], [12, 102], [14, 104]]);
  });
});
