import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  bulkDocketContentHash,
  courtListenerBulkDocketSchema,
} from "./bulk-dockets";
import { parseBulkCsv } from "./bulk";

describe("CourtListener bulk dockets", () => {
  it("parses the fields needed for year-scoped federal backfill", async () => {
    const csv = [
      "id,court_id,docket_number,case_name,date_filed,date_terminated,date_modified,cause,nature_of_suit",
      '"123","nysd","1:26-cv-00001","Example v. Example","2026-01-02","","2026-07-28T00:00:00Z","42:1983","440"',
    ].join("\n");
    const rows = [];
    for await (const row of parseBulkCsv(Readable.from(csv), courtListenerBulkDocketSchema)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "123",
      court_id: "nysd",
      date_filed: "2026-01-02",
    });
    expect(bulkDocketContentHash(rows[0]!)).toMatch(/^[a-f0-9]{64}$/);
  });
});
