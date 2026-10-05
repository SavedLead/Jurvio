import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bzip2Decompressor, parseBulkCsv, parseBulkCsvRecords } from "./bulk";

// The original character-at-a-time parser, kept verbatim as the oracle the faster
// scanner must match exactly (same rows, same field values, same errors).
async function* referenceParse(stream: Readable): AsyncGenerator<Record<string, string>> {
  stream.setEncoding("utf8");
  let headers: string[] | undefined;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let escaped = false;
  const finishRow = () => {
    row.push(field);
    field = "";
    const finished = row;
    row = [];
    return finished;
  };
  for await (const chunk of stream) {
    for (const character of chunk as string) {
      if (escaped) {
        field += character;
        escaped = false;
      } else if (quoted && character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (!quoted && character === ",") {
        row.push(field);
        field = "";
      } else if (!quoted && character === "\n") {
        const values = finishRow().map((value) => value.replace(/\r$/, ""));
        if (!headers) headers = values;
        else if (values.some(Boolean)) {
          yield Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
        }
      } else {
        field += character;
      }
    }
  }
  if (quoted || escaped) throw new Error("CourtListener bulk CSV ended inside a quoted field");
  if (field || row.length) {
    const values = finishRow();
    if (!headers) headers = values;
    else yield Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  try {
    for await (const row of iterable) rows.push(row);
    return { rows };
  } catch (error) {
    return { rows, error: (error as Error).message };
  }
}

function chunked(text: string, sizes: number[]): Readable {
  const chunks: string[] = [];
  let index = 0;
  let turn = 0;
  while (index < text.length) {
    const size = sizes[turn % sizes.length]!;
    chunks.push(text.slice(index, index + size));
    index += size;
    turn += 1;
  }
  return Readable.from(chunks);
}

// Deterministic PRNG so failures reproduce.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ALPHABET = ['"', '"', ",", ",", "\n", "\r", "\\", "a", "b", "é", "😀", " ", "1"];

describe("bulk CSV scanner equivalence", () => {
  it("matches the reference parser on randomized input and chunk boundaries", async () => {
    const next = random(20261005);
    for (let trial = 0; trial < 600; trial += 1) {
      const length = Math.floor(next() * 120);
      let text = "id,name,body\n";
      for (let index = 0; index < length; index += 1) {
        text += ALPHABET[Math.floor(next() * ALPHABET.length)];
      }
      const sizes = [1 + Math.floor(next() * 7), 1 + Math.floor(next() * 40), 64];
      const expected = await collect(referenceParse(chunked(text, sizes)));
      const actual = await collect(parseBulkCsv(chunked(text, sizes), z.record(z.string(), z.string())));
      expect(actual, JSON.stringify(text)).toEqual(expected);
    }
  });

  it("keeps escaped quotes, embedded newlines and CRLF rows intact", async () => {
    const text = 'id,text\r\n"1","say \\"hi\\",\nthen go"\r\n\r\n"2","a\\\\b"\r\n';
    const { rows } = await collect(parseBulkCsvRecords(chunked(text, [3])));
    expect(rows).toEqual([["id", "text"], ["1", 'say "hi",\nthen go'], ["2", "a\\b"]]);
  });
});

describe("bz2 decompressor selection", () => {
  it("prefers lbzip2 with an explicit thread count and honours overrides", () => {
    expect(bzip2Decompressor({ JURVIO_BZIP2_THREADS: "3" }, () => true))
      .toEqual({ command: "lbzip2", args: ["-dc", "-n", "3"] });
    expect(bzip2Decompressor({ JURVIO_BZIP2_DECOMPRESSOR: "bzip2" }, () => true))
      .toEqual({ command: "bzip2", args: ["-dc"] });
    expect(bzip2Decompressor({}, () => false)).toEqual({ command: "bzip2", args: ["-dc"] });
    expect(bzip2Decompressor({ JURVIO_BZIP2_THREADS: "zero" }, () => true).args).toEqual(["-dc", "-n", "1"]);
    // An empty value (e.g. an unset compose variable) means "all cores", not one.
    expect(Number(bzip2Decompressor({ JURVIO_BZIP2_THREADS: "" }, () => true).args[2])).toBeGreaterThanOrEqual(1);
    expect(bzip2Decompressor({ JURVIO_BZIP2_THREADS: "" }, () => true).args[2])
      .toBe(bzip2Decompressor({}, () => true).args[2]);
  });
});
