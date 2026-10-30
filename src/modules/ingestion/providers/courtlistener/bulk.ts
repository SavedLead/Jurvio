import { createReadStream, type ReadStream } from "node:fs";
import { spawn } from "node:child_process";
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
    const stream: ReadStream = createReadStream(filePath);
    let closedByConsumer = false;
    return {
      stream,
      close: () => {
        closedByConsumer = true;
        stream.destroy();
      },
      // A consumer that stops early (row limit, budget) destroys the stream, which
      // emits AbortError; that is a normal close, not an unhandled failure.
      completion: new Promise((resolve, reject) => {
        stream.once("end", resolve);
        stream.once("close", () => { if (closedByConsumer) resolve(); });
        stream.once("error", (error) => (closedByConsumer ? resolve() : reject(error)));
      }),
    };
  }

  const process = spawn("bzip2", ["-dc", filePath], {
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
        else reject(new Error(`bzip2 exited with code ${code}: ${standardError.trim()}`));
      });
    }),
  };
}

export async function* parseBulkCsv<T>(
  stream: Readable,
  schema: z.ZodType<T>,
): AsyncGenerator<T> {
  for await (const record of parseBulkCsvRecords(stream)) yield schema.parse(record);
}

const QUOTED_SPECIAL = /["\\]/g;
const UNQUOTED_SPECIAL = /[",\n]/g;

/**
 * CourtListener's bulk CSV dialect: `"` toggles quoting, a backslash inside quotes
 * escapes the next character, and rows end at an unquoted newline. Scans for the
 * next special character with a native regex and appends whole slices, instead of
 * appending one character at a time, so multi-hundred-GB opinion text streams are
 * not bound by per-character string building. Output is identical to the previous
 * per-character parser (see bulk.test.ts equivalence test).
 */
export async function* parseBulkCsvRecords(stream: Readable): AsyncGenerator<Record<string, string>> {
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
  const record = (values: string[]) =>
    Object.fromEntries(headers!.map((header, index) => [header, values[index] ?? ""]));

  for await (const chunk of stream) {
    const text = chunk as string;
    const length = text.length;
    let index = 0;
    while (index < length) {
      if (escaped) {
        // The escaped character is kept; a surrogate pair stays intact because its second
        // half is appended by the next slice.
        field += text[index];
        escaped = false;
        index += 1;
        continue;
      }
      const special = quoted ? QUOTED_SPECIAL : UNQUOTED_SPECIAL;
      special.lastIndex = index;
      const found = special.exec(text);
      if (!found) {
        field += text.slice(index);
        break;
      }
      const at = found.index;
      if (at > index) field += text.slice(index, at);
      index = at + 1;
      const character = text[at];
      if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else {
        const values = finishRow().map((value) => value.replace(/\r$/, ""));
        if (!headers) {
          headers = values;
        } else if (values.some(Boolean)) {
          yield record(values);
        }
      }
    }
  }

  if (quoted || escaped) throw new Error("CourtListener bulk CSV ended inside a quoted field");
  if (field || row.length) {
    const values = finishRow();
    if (!headers) headers = values;
    else yield record(values);
  }
}

/** The original per-character parser, kept only as the reference for the equivalence test. */
export async function* parseBulkCsvRecordsReference(stream: Readable): AsyncGenerator<Record<string, string>> {
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
        if (!headers) {
          headers = values;
        } else if (values.some(Boolean)) {
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
