import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

/**
 * Structural inspection of a `pg_dump | gzip` file.
 *
 * A restore rehearsal that only checks "the object downloaded and decrypted" can
 * still pass on a dump with no schema or no rows. This walks the decompressed
 * stream and counts the statements that distinguish a real recovery point from
 * an empty one — without ever holding the dump in memory, since it is tens of
 * gigabytes uncompressed. A truncated gzip stream surfaces here as an error
 * from the decompressor rather than as a quietly short read.
 */
export interface DumpInspection {
  uncompressedBytes: number;
  createTableStatements: number;
  copyStatements: number;
}

/** Counts dump statements in a line, used across chunk boundaries. */
export function countDumpStatements(line: string): { createTable: number; copy: number } {
  if (line.startsWith("CREATE TABLE ")) return { createTable: 1, copy: 0 };
  if (line.startsWith("COPY ")) return { createTable: 0, copy: 1 };
  return { createTable: 0, copy: 0 };
}

/** Problems that make a dump unusable as a recovery point. Empty means healthy. */
export function dumpProblems(inspection: DumpInspection, fileBytes: number): string[] {
  const problems: string[] = [];
  if (fileBytes === 0) problems.push("decrypted file is empty");
  if (inspection.createTableStatements === 0) {
    problems.push("dump contains no CREATE TABLE statements");
  }
  if (inspection.copyStatements === 0) problems.push("dump contains no COPY (data) statements");
  return problems;
}

export async function inspectDatabaseDump(path: string): Promise<DumpInspection> {
  let uncompressedBytes = 0;
  let createTableStatements = 0;
  let copyStatements = 0;
  let carry = "";

  const stream = createReadStream(path).pipe(createGunzip());
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    uncompressedBytes += buffer.length;
    // latin1 is a byte-preserving decode, so a multi-byte character split across
    // a chunk boundary cannot corrupt the line framing the counters rely on.
    const lines = (carry + buffer.toString("latin1")).split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      const counted = countDumpStatements(line);
      createTableStatements += counted.createTable;
      copyStatements += counted.copy;
    }
  }
  const trailing = countDumpStatements(carry);
  return {
    uncompressedBytes,
    createTableStatements: createTableStatements + trailing.createTable,
    copyStatements: copyStatements + trailing.copy,
  };
}
