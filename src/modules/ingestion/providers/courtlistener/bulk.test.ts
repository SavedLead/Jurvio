import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  courtListenerBulkCourtSchema,
  parseBulkCsv,
} from "./bulk";

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
});
