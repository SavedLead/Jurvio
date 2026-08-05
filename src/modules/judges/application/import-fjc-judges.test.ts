import { describe, expect, it } from "vitest";
import { parseCsv, parseSeatId } from "./import-fjc-judges";

describe("FJC roster parsing", () => {
  it("parses quoted CSV cells and FJC seat succession IDs", () => {
    expect(parseCsv('nid,First Name,Last Name\r\n1,"Jane, A.",Smith\r\n')).toEqual([
      { nid: "1", "First Name": "Jane, A.", "Last Name": "Smith" },
    ]);
    expect(parseSeatId("NYSD0302")).toEqual({ courtCode: "nysd", seat: 3, succession: 2 });
  });

  it("rejects values that are not FJC seat IDs", () => {
    expect(parseSeatId("unknown")).toBeNull();
  });
});
