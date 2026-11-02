import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeScdbText, docketKey, parseCsv, readSingleFileZip, scdbDate, scdbInt, scdbText, usReportsKey } from "./scdb";

function zipOf(name: string, data: Buffer, method: 0 | 8 = 8): Buffer {
  const body = method === 8 ? deflateRawSync(data) : data;
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + body.length;
  const centralSize = central.length + nameBytes.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, body, central, nameBytes, eocd]);
}

describe("SCDB file parsing", () => {
  it("parses quoted CSV with doubled quotes, commas, CRLF and a BOM", () => {
    const rows = parseCsv('\ufeff"caseId","caseName",term\r\n"1946-001","SMITH, ""JR."" v. JONES",1946\r\n"1946-002",,1946\n');
    expect(rows).toEqual([
      { caseId: "1946-001", caseName: 'SMITH, "JR." v. JONES', term: "1946" },
      { caseId: "1946-002", caseName: "", term: "1946" },
    ]);
  });

  it("refuses rows whose field count does not match the header", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/3 fields/);
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(/quoted field/);
  });

  it("reads UTF-8 and falls back to Windows-1252 (SCDB Legacy files)", () => {
    expect(decodeScdbText(Buffer.from("Gonz\u00e1lez", "utf8"))).toEqual({ text: "Gonz\u00e1lez", encoding: "utf-8" });
    expect(decodeScdbText(Buffer.from([0x47, 0x6f, 0x6e, 0x7a, 0xe1, 0x6c, 0x65, 0x7a, 0x92]))).toEqual({
      text: "Gonz\u00e1lez\u2019", encoding: "windows-1252",
    });
  });

  it("extracts the single CSV from a deflated or stored zip", () => {
    const csv = Buffer.from("caseId,term\n1946-001,1946\n");
    expect(readSingleFileZip(zipOf("SCDB.csv", csv))).toEqual({ name: "SCDB.csv", data: csv });
    expect(readSingleFileZip(zipOf("SCDB.csv", csv, 0)).data.toString()).toBe(csv.toString());
    expect(() => readSingleFileZip(Buffer.from("not a zip at all, definitely not"))).toThrow(/not a zip/);
  });

  it("maps SCDB empty and NA values to null and rejects malformed numbers and dates", () => {
    expect(scdbInt("")).toBeNull();
    expect(scdbInt("NA")).toBeNull();
    expect(scdbInt("118")).toBe(118);
    expect(() => scdbInt("1.5")).toThrow();
    expect(scdbText("  NA ")).toBeNull();
    expect(scdbDate("6/22/2026")).toBe("2026-06-22");
    expect(scdbDate("")).toBeNull();
    expect(() => scdbDate("2/30/2026")).toThrow(/impossible/);
    expect(() => scdbDate("2026-06-22")).toThrow();
  });

  it("builds the same keys the citation graph and dockets use", () => {
    expect(usReportsKey("410 U.S. 113")).toBe("410us113");
    expect(usReportsKey("603 U.S. 369 (2024)")).toBe("603us369");
    expect(usReportsKey("146 S. Ct. 1873")).toBeNull();
    expect(usReportsKey(null)).toBeNull();
    expect(docketKey("No. 25-748")).toBe("25748");
    expect(docketKey("25-748")).toBe("25748");
    expect(docketKey("22O141")).toBe("22o141");
    expect(docketKey("")).toBeNull();
  });
});
