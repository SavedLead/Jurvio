import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  bulkOpinionPlainText,
  bulkOpinionWordCount,
  courtListenerBulkOpinionClusterSchema,
  courtListenerBulkOpinionSchema,
  normalizeBulkOpinionType,
  readBulkOpinions,
} from "./bulk-opinions";
import { parseBulkCsv } from "./bulk";

describe("CourtListener bulk opinion schemas", () => {
  it("parses opinion-cluster rows and coerces defaults", async () => {
    const csv = [
      "id,docket_id,case_name,date_filed,precedential_status,citation_count,judges",
      '"901","55","United States v. Example","2021-06-04","Published","7","Smith, Jones"',
    ].join("\n");
    const rows = [];
    for await (const row of parseBulkCsv(Readable.from(csv), courtListenerBulkOpinionClusterSchema)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "901",
      docket_id: "55",
      case_name: "United States v. Example",
      date_filed: "2021-06-04",
      precedential_status: "Published",
      citation_count: "7",
    });
    expect(rows[0]?.syllabus).toBe("");
    expect(rows[0]?.procedural_history).toBe("");
  });

  it("parses opinion rows and normalizes per_curiam / ocr booleans", async () => {
    const csv = [
      "id,cluster_id,type,per_curiam,extracted_by_ocr,plain_text,sha1",
      '"7001","901","020lead","t","f","Opinion body text.","abc123"',
    ].join("\n");
    const rows = [];
    for await (const row of readBulkOpinions({
      stream: Readable.from(csv),
      close: () => {},
      completion: Promise.resolve(),
    })) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cluster_id).toBe("901");
    expect(rows[0]?.per_curiam).toBe(true);
    expect(rows[0]?.extracted_by_ocr).toBe(false);
    expect(rows[0]?.plain_text).toBe("Opinion body text.");
  });
});

describe("normalizeBulkOpinionType", () => {
  it("maps CourtListener type codes to the internal enum", () => {
    expect(normalizeBulkOpinionType("010combined")).toBe("majority");
    expect(normalizeBulkOpinionType("020lead")).toBe("majority");
    expect(normalizeBulkOpinionType("025plurality")).toBe("plurality");
    expect(normalizeBulkOpinionType("030concurrence")).toBe("concurrence");
    expect(normalizeBulkOpinionType("035concurrenceinpart")).toBe("concurrence");
    expect(normalizeBulkOpinionType("040dissent")).toBe("dissent");
    expect(normalizeBulkOpinionType("050addendum")).toBe("addendum");
    expect(normalizeBulkOpinionType("070rehearing")).toBe("rehearing");
  });

  it("falls back to majority for unknown codes", () => {
    expect(normalizeBulkOpinionType("")).toBe("majority");
    expect(normalizeBulkOpinionType("999unknown")).toBe("majority");
  });
});

describe("bulkOpinionPlainText", () => {
  const base = courtListenerBulkOpinionSchema.parse({ id: "1", cluster_id: "2" });

  it("prefers plain_text when present", () => {
    const result = bulkOpinionPlainText({ ...base, plain_text: "Hello world" });
    expect(result.text).toBe("Hello world");
    expect(result.html).toBeNull();
    expect(result.method).toBe("courtlistener_bulk_text");
  });

  it("marks OCR extraction when plain_text came from OCR", () => {
    const result = bulkOpinionPlainText({ ...base, plain_text: "Scanned", extracted_by_ocr: true });
    expect(result.method).toBe("courtlistener_bulk_ocr");
  });

  it("strips HTML when only an HTML column is populated", () => {
    const result = bulkOpinionPlainText({
      ...base,
      html_with_citations: "<p>Affirmed &amp; remanded.</p>",
    });
    expect(result.text).toBe("Affirmed & remanded.");
    expect(result.html).toBe("<p>Affirmed &amp; remanded.</p>");
    expect(result.method).toBe("courtlistener_bulk_html");
  });

  it("returns empty text when no content column is populated", () => {
    const result = bulkOpinionPlainText(base);
    expect(result.text).toBe("");
    expect(result.html).toBeNull();
  });
});

describe("bulkOpinionWordCount", () => {
  it("counts whitespace-delimited words", () => {
    expect(bulkOpinionWordCount("one two three")).toBe(3);
    expect(bulkOpinionWordCount("  spaced   out  words ")).toBe(3);
  });

  it("returns zero for empty or blank text", () => {
    expect(bulkOpinionWordCount("")).toBe(0);
    expect(bulkOpinionWordCount("   ")).toBe(0);
  });
});
