import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countDumpStatements,
  dumpProblems,
  inspectDatabaseDump,
} from "./inspect-database-dump";

const DUMP = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "CREATE TABLE public.legal_case (",
  "    id uuid NOT NULL",
  ");",
  "CREATE TABLE public.document (",
  "    id uuid NOT NULL",
  ");",
  "COPY public.legal_case (id) FROM stdin;",
  "8a1d0e2c-0000-0000-0000-000000000000",
  "\\.",
  "",
].join("\n");

describe("dump statement counting", () => {
  it("counts only statements at the start of a line", () => {
    expect(countDumpStatements("CREATE TABLE public.x (")).toEqual({ createTable: 1, copy: 0 });
    expect(countDumpStatements("COPY public.x (id) FROM stdin;")).toEqual({ createTable: 0, copy: 1 });
    // Row data that merely mentions the words must not be counted.
    expect(countDumpStatements("  CREATE TABLE inside indented SQL")).toEqual({ createTable: 0, copy: 0 });
    expect(countDumpStatements("some row mentioning COPY and CREATE TABLE")).toEqual({
      createTable: 0,
      copy: 0,
    });
  });
});

describe("restore-rehearsal verdict", () => {
  it("passes only a dump carrying both schema and data", () => {
    expect(dumpProblems({ uncompressedBytes: 10, createTableStatements: 2, copyStatements: 1 }, 10)).toEqual([]);
  });

  it("rejects an empty file, a schema-only dump, and a dump with no tables", () => {
    expect(dumpProblems({ uncompressedBytes: 0, createTableStatements: 0, copyStatements: 0 }, 0)).toEqual([
      "decrypted file is empty",
      "dump contains no CREATE TABLE statements",
      "dump contains no COPY (data) statements",
    ]);
    expect(
      dumpProblems({ uncompressedBytes: 10, createTableStatements: 5, copyStatements: 0 }, 10),
    ).toEqual(["dump contains no COPY (data) statements"]);
  });
});

describe("inspecting a real gzip stream", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jurvio-dump-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("counts schema and data across the decompressed stream", async () => {
    const path = join(dir, "dump.sql.gz");
    await writeFile(path, gzipSync(Buffer.from(DUMP, "utf8")));
    const inspection = await inspectDatabaseDump(path);
    expect(inspection.createTableStatements).toBe(2);
    expect(inspection.copyStatements).toBe(1);
    expect(inspection.uncompressedBytes).toBe(Buffer.byteLength(DUMP));
    expect(dumpProblems(inspection, 1)).toEqual([]);
  });

  it("counts a final statement that has no trailing newline", async () => {
    const path = join(dir, "dump.sql.gz");
    await writeFile(path, gzipSync(Buffer.from("CREATE TABLE a (\n);\nCOPY a (id) FROM stdin;", "utf8")));
    const inspection = await inspectDatabaseDump(path);
    expect(inspection.copyStatements).toBe(1);
  });

  it("fails loudly on a truncated archive rather than reporting a short dump", async () => {
    const path = join(dir, "truncated.sql.gz");
    const complete = gzipSync(Buffer.from(DUMP, "utf8"));
    await writeFile(path, complete.subarray(0, complete.length - 12));
    await expect(inspectDatabaseDump(path)).rejects.toThrow();
  });
});
