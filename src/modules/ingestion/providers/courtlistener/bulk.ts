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

export function openBulkCsv(filePath: string): BulkCsvSource {
  if (!filePath.endsWith(".bz2")) {
    const stream: ReadStream = createReadStream(filePath);
    return {
      stream,
      close: () => stream.destroy(),
      completion: new Promise((resolve, reject) => {
        stream.once("end", resolve);
        stream.once("error", reject);
      }),
    };
  }

  const process = spawn("bzip2", ["-dc", filePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let standardError = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });

  return {
    stream: process.stdout,
    close: () => process.kill("SIGTERM"),
    completion: new Promise((resolve, reject) => {
      process.once("error", reject);
      process.once("close", (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`bzip2 exited with code ${code}: ${standardError.trim()}`));
      });
    }),
  };
}

export async function* parseBulkCsv<T>(
  stream: Readable,
  schema: z.ZodType<T>,
): AsyncGenerator<T> {
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
          yield schema.parse(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
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
    else yield schema.parse(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }
}
