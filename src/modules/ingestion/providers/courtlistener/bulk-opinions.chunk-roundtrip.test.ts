import { describe, expect, it } from "vitest";
import {
  courtListenerBulkOpinionChunkSchema,
  courtListenerBulkOpinionSchema,
} from "./bulk-opinions";

// Reproduces the chunk round-trip the pipeline performs:
//   extract: raw CSV row -> courtListenerBulkOpinionSchema.parse -> typed object
//   sink:    JSON.stringify(typed object)                        -> one JSONL line
//   import:  JSON.parse(line) -> courtListenerBulkOpinionChunkSchema.parse
// The first pilot failed here: the importer re-used the CSV schema, which expects every
// field as a string, so the parsed booleans/nulls threw `invalid_type` on every record.

const rawCsvRow = {
  id: "12345",
  cluster_id: "67890",
  type: "020lead",
  author_id: "", // nullableBulkString -> null
  author_str: "Smith, J.",
  per_curiam: "f", // bulkBoolean -> false
  ordering_key: "", // -> null
  download_url: "https://example.test/x.pdf",
  sha1: "abc",
  page_count: "", // -> null
  extracted_by_ocr: "t", // -> true
  plain_text: "The opinion text.",
  date_modified: "2026-09-30",
};

describe("bulk opinion chunk round-trip (extract -> JSONL -> import)", () => {
  it("re-parses actual splitter output, preserving null and boolean fields", () => {
    const parsed = courtListenerBulkOpinionSchema.parse(rawCsvRow);
    // Sanity: the CSV transforms ran (these are the types that broke the importer).
    expect(parsed.author_id).toBeNull();
    expect(parsed.per_curiam).toBe(false);
    expect(parsed.page_count).toBeNull();
    expect(parsed.extracted_by_ocr).toBe(true);

    const line = JSON.stringify(parsed); // what the splitter sink writes
    const reparsed = courtListenerBulkOpinionChunkSchema.parse(JSON.parse(line));

    expect(reparsed.id).toBe("12345");
    expect(reparsed.cluster_id).toBe("67890");
    expect(reparsed.author_id).toBeNull();
    expect(reparsed.per_curiam).toBe(false);
    expect(reparsed.page_count).toBeNull();
    expect(reparsed.extracted_by_ocr).toBe(true);
    expect(reparsed.plain_text).toBe("The opinion text.");
  });

  it("handles a true per_curiam / present author_id round-trip", () => {
    const parsed = courtListenerBulkOpinionSchema.parse({
      ...rawCsvRow,
      author_id: "42",
      per_curiam: "t",
      page_count: "17",
      extracted_by_ocr: "f",
    });
    const reparsed = courtListenerBulkOpinionChunkSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed.author_id).toBe("42");
    expect(reparsed.per_curiam).toBe(true);
    expect(reparsed.page_count).toBe("17");
    expect(reparsed.extracted_by_ocr).toBe(false);
  });

  it("confirms the old bug: the CSV schema rejects serialized (typed) chunk output", () => {
    const parsed = courtListenerBulkOpinionSchema.parse(rawCsvRow);
    const serialized = JSON.parse(JSON.stringify(parsed));
    // per_curiam is now boolean, author_id/page_count null -> the string-expecting CSV
    // schema throws exactly as it did in the failed pilot.
    expect(() => courtListenerBulkOpinionSchema.parse(serialized)).toThrow();
  });
});
