import { describe, expect, it } from "vitest";
import {
  officialOpinionTextToHtml,
  resolveOfficialScotusPageEnd,
  trimOfficialScotusBoundVolumeText,
  validateOfficialScotusText,
} from "./extract-official-scotus-opinion-text";

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
  it("infers a missing segment end from the next opinion in the same artifact", () => {
    expect(resolveOfficialScotusPageEnd(null, 297)).toBe(296);
    expect(resolveOfficialScotusPageEnd(295, 297)).toBe(295);
    expect(resolveOfficialScotusPageEnd(null, null)).toBeNull();
  });
  it("stops an unbounded volume segment at the next opinion header", () => {
    const ownFirstPage = "OCTOBER TERM, 2014 105\nUNITED STATES v. CALIFORNIA";
    const ownLaterPage = "Cite as: 574 U. S. 105 (2014) 257\nFinal decree text";
    const nextOpinion = "OCTOBER TERM, 2014 259\nNEXT CASE";
    const trailingPage = "Cite as: 574 U. S. 259 (2015) 261";
    expect(trimOfficialScotusBoundVolumeText(
      [ownFirstPage, ownLaterPage, nextOpinion, trailingPage].join("\f"),
      "574 U.S. 105",
    )).toBe([ownFirstPage, ownLaterPage].join("\f"));
  });
  it("leaves text unchanged when its official citation marker is absent", () => {
    expect(trimOfficialScotusBoundVolumeText("Court text", "574 U.S. 105")).toBe("Court text");
  });
  it("rejects thin or unrelated output", () => {
    expect(validateOfficialScotusText("Page 1", "24-1159").valid).toBe(false);
  });
  it("escapes extracted text before rendering paragraphs", () => {
    expect(officialOpinionTextToHtml("A & B\n\n<Court>")).toBe("<p>A &amp; B</p>\n<p>&lt;Court&gt;</p>");
  });
});
