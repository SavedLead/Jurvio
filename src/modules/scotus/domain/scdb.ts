import { inflateRawSync } from "node:zlib";

/**
 * Parsing helpers for the Supreme Court Database (SCDB) release files.
 * Pure functions: no I/O, no guessing. A value the SCDB leaves empty (or
 * writes as "NA") becomes null.
 */

export type CsvRecord = Record<string, string>;

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (i < source.length) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i += 1; continue; }
    if (ch === ",") { row.push(field); field = ""; i += 1; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      i += ch === "\r" && source[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch; i += 1;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((values, index) => {
    if (values.length !== header.length) {
      throw new Error(`CSV row ${index + 2} has ${values.length} fields, header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, column) => [name, values[column]!]));
  });
}

/** SCDB modern files are UTF-8; Legacy 07 is Windows-1252. Never silently mangle. */
export function decodeScdbText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** Read the single file inside a .zip (stored or deflated), as SCDB publishes them. */
export function readSingleFileZip(zip: Buffer): { name: string; data: Buffer } {
  const eocdMin = 22;
  let eocd = -1;
  for (let i = zip.length - eocdMin; i >= Math.max(0, zip.length - eocdMin - 0xffff); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const entries = zip.readUInt16LE(eocd + 10);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  const files: { name: string; data: Buffer }[] = [];
  let p = centralOffset;
  for (let n = 0; n < entries; n += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || name.startsWith("__MACOSX/")) continue;
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("corrupt zip local header");
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`unsupported zip compression method ${method}`);
    if (data.length !== size) throw new Error(`zip entry ${name} inflated to ${data.length} bytes, expected ${size}`);
    files.push({ name, data });
  }
  if (files.length !== 1) throw new Error(`expected exactly one file in the zip, found ${files.length}`);
  return files[0]!;
}

export function scdbInt(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (v === "" || v.toUpperCase() === "NA") return null;
  if (!/^-?\d+$/.test(v)) throw new Error(`expected an integer, got ${JSON.stringify(value)}`);
  return Number(v);
}

export function scdbText(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" || v.toUpperCase() === "NA" ? null : v;
}

/** SCDB dates are M/D/YYYY. Returns ISO YYYY-MM-DD, or null when empty. */
export function scdbDate(value: string | undefined): string | null {
  const v = scdbText(value);
  if (!v) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) throw new Error(`expected an M/D/YYYY date, got ${JSON.stringify(value)}`);
  const [year, month, day] = [Number(m[3]), Number(m[1]), Number(m[2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`impossible date ${JSON.stringify(value)}`);
  }
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "410 U.S. 113" -> "410us113" (the same key shape as citationKey for U.S. Reports). */
export function usReportsKey(value: string | null | undefined): string | null {
  const m = /^\s*(\d+)\s*U\.?\s*S\.?\s+(\d+)\b/i.exec(value ?? "");
  if (!m) return null;
  return `${Number(m[1])}us${Number(m[2])}`;
}

/** Docket comparison key: drop a leading "No."/"Nos.", lower-case, keep letters and digits. */
export function docketKey(value: string | null | undefined): string | null {
  const v = (value ?? "").toLowerCase().replace(/^\s*nos?\.?\s*/, "").replace(/[^a-z0-9]/g, "");
  return v === "" ? null : v;
}

export const SCDB_ISSUE_AREAS = 14;
