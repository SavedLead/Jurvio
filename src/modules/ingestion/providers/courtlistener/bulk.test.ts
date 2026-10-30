import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  bulkCsvProcessCompleted,
  courtListenerBulkCourtSchema,
  parseBulkCsv,
  parseBulkCsvRecords,
  parseBulkCsvRecordsReference,
} from "./bulk";

async function collect(generator: AsyncGenerator<Record<string, string>>) {
  const rows: Record<string, string>[] = [];
  let error: string | null = null;
  try {
    for await (const row of generator) rows.push(row);
  } catch (caught) {
    error = (caught as Error).message;
  }
  return { rows, error };
}

/** Random text over the characters that matter to the CSV state machine, plus multi-byte ones. */
function randomCsv(seed: number): string {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const alphabet = ["a", "b", " ", ",", "\n", "\r", '"', "\\", "é", "😀", "x", "1"];
  const header = "id,cluster_id,plain_text\n";
  let body = "";
  const length = Math.floor(next() * 400);
  for (let index = 0; index < length; index += 1) body += alphabet[Math.floor(next() * alphabet.length)];
  return header + body;
}

function chunked(text: string, seed: number): Readable {
  const parts: string[] = [];
  let index = 0;
  let state = seed;
  while (index < text.length) {
    state = (state * 48_271) % 2_147_483_647;
    const size = 1 + (state % 17);
    // Split on code points so a chunk never ends inside a surrogate pair (a utf8 stream decoder never does).
    const piece = Array.from(text.slice(index)).slice(0, size).join("");
    parts.push(piece);
    index += piece.length;
  }
  return Readable.from(parts.map((part) => Buffer.from(part, "utf8")));
}

describe("CourtListener bulk CSV", () => {
  it("parses quoted, multi-line fields without corrupting later rows", async () => {
    const csv = [
      "id,pacer_court_id,short_name,full_name,url,jurisdiction,date_modified,notes",
      '"nc","","N.C.","Supreme Court of North Carolina","https://example.test","S","2026-03-31","line one',
      'line two"',
      '"ca1","01ca1","1st Cir.","Court of Appeals for the First Circuit","https://example.test/ca1","F","2026-03-31",""',
    ].join("\n");

    const rows = [];
    for await (const row of parseBulkCsv(Readable.from(csv), courtListenerBulkCourtSchema)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(2);
    expect(rows[1]?.id).toBe("ca1");
  });

  it("parses exactly like the per-character reference parser on random input and chunking", async () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const text = randomCsv(seed);
      const fast = await collect(parseBulkCsvRecords(chunked(text, seed)));
      const reference = await collect(parseBulkCsvRecordsReference(Readable.from([text])));
      expect(fast, `seed ${seed}`).toEqual(reference);
    }
  });

  it("keeps backslash escapes, toggled quotes and CRLF handling of the CourtListener dialect", async () => {
    const text = 'id,cluster_id,plain_text\r\n"1","2","a \\"quoted\\" \\\\ path, and\nnew line"\r\n3,4,"x""y"\n';
    const { rows, error } = await collect(parseBulkCsvRecords(Readable.from([text])));
    expect(error).toBeNull();
    expect(rows).toEqual([
      { id: "1", cluster_id: "2", plain_text: 'a "quoted" \\ path, and\nnew line' },
      { id: "3", cluster_id: "4", plain_text: "xy" },
    ]);
  });

  it("accepts an intentional bounded close without hiding real decompressor failures", () => {
    expect(bulkCsvProcessCompleted(1, true)).toBe(true);
    expect(bulkCsvProcessCompleted(1, false)).toBe(false);
    expect(bulkCsvProcessCompleted(0, false)).toBe(true);
  });
});
