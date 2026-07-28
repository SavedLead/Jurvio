import { describe, expect, it } from "vitest";
import { officialOpinionTextToHtml, validateOfficialScotusText } from "./extract-official-scotus-opinion-text";

describe("official SCOTUS native text extraction", () => {
  it("accepts substantial official text with a matching docket", () => {
    const text = "SUPREME COURT OF THE UNITED STATES\nNo. 24-1159\n\n" + "Court opinion text ".repeat(180);
    expect(validateOfficialScotusText(text, "24-1159").valid).toBe(true);
  });
  it("accepts readable Court text with wide layout spacing", () => {
    const text = [
      "SUPREME COURT OF THE UNITED STATES",
      "No. 19-7",
      ...Array.from({ length: 180 }, (_, index) =>
        `The Court explains the verified legal question and judgment in paragraph ${index}.          `
      ),
    ].join("\n\n");
    expect(validateOfficialScotusText(text, "19-7").valid).toBe(true);
  });
  it("accepts a substantial verified preliminary-print segment without a repeated title marker", () => {
    const text = "The constitutional judgment and legal analysis follow. ".repeat(5_100);
    expect(validateOfficialScotusText(text, "19-7").valid).toBe(true);
  });
  it("rejects thin or unrelated output", () => {
    expect(validateOfficialScotusText("Page 1", "24-1159").valid).toBe(false);
  });
  it("escapes extracted text before rendering paragraphs", () => {
    expect(officialOpinionTextToHtml("A & B\n\n<Court>")).toBe("<p>A &amp; B</p>\n<p>&lt;Court&gt;</p>");
  });
});
