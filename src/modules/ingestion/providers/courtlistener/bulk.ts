import { createReadStream, type ReadStream } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import type { Readable } from "node:stream";
import { z } from "zod";

export const courtListenerBulkCourtSchema = z.object({
  id: z.string().min(1),
  pacer_court_id: z.string(),
  short_name: z.string().min(1),
  full_name: z.string().min(1),
  url: z.string(),
  jurisdiction: z.string(),
  date_modified: z.string(),
});

export type CourtListenerBulkCourt = z.infer<typeof courtListenerBulkCourtSchema>;

export interface BulkCsvSource {
  stream: Readable;
  close: () => void;
  completion: Promise<void>;
}

export function bulkCsvProcessCompleted(
  code: number | null,
  closedByConsumer: boolean,
): boolean {
  return code === 0 || code === null || closedByConsumer;
}

export function openBulkCsv(filePath: string): BulkCsvSource {
  if (!filePath.endsWith(".bz2")) {
    const stream: ReadStream = createReadStream(filePath, { highWaterMark: 1 << 20 });
    return {
      stream,
      close: () => stream.destroy(),
      completion: new Promise((resolve, reject) => {
        stream.once("end", resolve);
        stream.once("error", reject);
      }),
    };
  }

  const decompressor = bzip2Decompressor();
  const process = spawn(decompressor.command, [...decompressor.args, filePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let standardError = "";
  let closedByConsumer = false;
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });

  return {
    stream: process.stdout,
    close: () => {
      closedByConsumer = true;
      process.kill("SIGTERM");
    },
    completion: new Promise((resolve, reject) => {
      process.once("error", reject);
      process.once("close", (code) => {
        if (bulkCsvProcessCompleted(code, closedByConsumer)) resolve();
        else reject(new Error(`${decompressor.command} exited with code ${code}: ${standardError.trim()}`));
      });
    }),
  };
}

export interface Bzip2Decompressor {
  command: string;
  // Arguments that decompress to stdout; append a file path, or none to read stdin.
  args: string[];
}

let detectedDecompressor: Bzip2Decompressor | undefined;

/**
 * Pick the bz2 decompressor. lbzip2 decompresses one bz2 stream on every core and
 * measured ~5x faster than bzip2 on the real 2026-09-30 opinions export (4 cores),
 * so it is preferred whenever it is installed. JURVIO_BZIP2_DECOMPRESSOR=bzip2
 * forces the single-threaded tool; JURVIO_BZIP2_THREADS caps lbzip2's threads so
 * a loader sharing a host can leave cores free.
 */
export function bzip2Decompressor(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  lbzip2Available: () => boolean = () => !spawnSync("lbzip2", ["-V"], { stdio: "ignore" }).error,
): Bzip2Decompressor {
  if (environment === process.env && detectedDecompressor) return detectedDecompressor;
  const requested = environment.JURVIO_BZIP2_THREADS?.trim();
  const threads = requested ? Number(requested) : availableParallelism();
  const decompressor: Bzip2Decompressor =
    environment.JURVIO_BZIP2_DECOMPRESSOR !== "bzip2" && lbzip2Available()
      ? {
          command: "lbzip2",
          args: ["-dc", "-n", String(Number.isInteger(threads) && threads > 0 ? threads : 1)],
        }
      : { command: "bzip2", args: ["-dc"] };
  if (environment === process.env) detectedDecompressor = decompressor;
  return decompressor;
}

const CARRIAGE_RETURN = /\r$/;
const QUOTED_STOP = /["\\]/g;
const PLAIN_STOP = /[,\n"]/g;

/**
 * Split a CourtListener bulk CSV stream into raw string records. The header is
 * always the first record; later all-empty records are dropped. Fields may be
 * quoted, quoted fields may span lines, and a backslash inside quotes escapes the
 * next character (PostgreSQL COPY CSV with ESCAPE '\\').
 *
 * The scanner jumps between delimiters with sticky regex searches and slices the
 * text in between instead of appending one character at a time. On the real
 * opinions export that is the difference between a parser that caps the whole
 * import at ~22 MB/s and one that keeps up with parallel decompression. Callers
 * that only need a few columns to decide whether a row matters (the id
 * prefilters) read the record directly and skip schema parsing entirely.
 */
export async function* parseBulkCsvRecords(stream: Readable): AsyncGenerator<string[]> {
  stream.setEncoding("utf8");
  let headerSeen = false;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let escaped = false;
  const quotedStop = new RegExp(QUOTED_STOP.source, "g");
  const plainStop = new RegExp(PLAIN_STOP.source, "g");

  for await (const chunk of stream as AsyncIterable<string>) {
    const length = chunk.length;
    let index = 0;
    while (index < length) {
      if (escaped) {
        field += chunk[index];
        escaped = false;
        index += 1;
        continue;
      }
      const stop = quoted ? quotedStop : plainStop;
      stop.lastIndex = index;
      const match = stop.exec(chunk);
      if (!match) {
        field += chunk.slice(index);
        break;
      }
      const at = match.index;
      if (at > index) field += chunk.slice(index, at);
      index = at + 1;
      const character = chunk.charCodeAt(at);
      if (quoted) {
        if (character === 92) escaped = true;
        else quoted = false;
      } else if (character === 34) {
        quoted = true;
      } else if (character === 44) {
        row.push(field);
        field = "";
      } else {
        row.push(field);
        field = "";
        const values = row;
        row = [];
        let nonEmpty = false;
        for (let column = 0; column < values.length; column += 1) {
          const value = values[column]!;
          if (value.endsWith("\r")) values[column] = value.replace(CARRIAGE_RETURN, "");
          if (values[column]) nonEmpty = true;
        }
        if (!headerSeen) {
          headerSeen = true;
          yield values;
        } else if (nonEmpty) {
          yield values;
        }
      }
    }
  }

  if (quoted || escaped) throw new Error("CourtListener bulk CSV ended inside a quoted field");
  if (field || row.length) {
    row.push(field);
    headerSeen = true;
    yield row;
  }
}

export function bulkCsvRecordObject(
  headers: readonly string[],
  values: readonly string[],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (let index = 0; index < headers.length; index += 1) {
    record[headers[index]!] = values[index] ?? "";
  }
  return record;
}

export async function* parseBulkCsv<T>(
  stream: Readable,
  schema: z.ZodType<T>,
): AsyncGenerator<T> {
  let headers: string[] | undefined;
  for await (const values of parseBulkCsvRecords(stream)) {
    if (!headers) {
      headers = values;
      continue;
    }
    yield schema.parse(bulkCsvRecordObject(headers, values));
  }
}
