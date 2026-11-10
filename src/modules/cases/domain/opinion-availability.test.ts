import { describe, expect, it } from "vitest";
import { officialOpinionNotice, opinionHasExtractedText, opinionTextIsPending, viewableOpinionPdf } from "./opinion-availability";

describe("opinion text availability", () => {
  it("asks for a notice only when no readable opinion is published", () => {
    expect(opinionTextIsPending(false)).toBe(true);
    expect(opinionTextIsPending(true)).toBe(false);
  });

  it("points to the official opinion in reader-facing words", () => {
    const notice = officialOpinionNotice("https://tile.loc.gov/storage-services/service/ll/usrep/usrep384/usrep384436/usrep384436.pdf");
    expect(notice?.heading).toBe("Read the court's full opinion");
    expect(notice?.body).toMatch(/United States Reports/);
    expect(notice?.linkLabel).toBe("Read the official opinion (PDF)");
    for (const text of [notice?.heading, notice?.body, notice?.linkLabel]) {
      expect(text).not.toMatch(/Jurvio|yet|pending|hold|quarantine|draft|verified/i);
    }
  });

  it("shows nothing when there is no official link", () => {
    expect(officialOpinionNotice(null)).toBeNull();
    expect(officialOpinionNotice("javascript:alert(1)")).toBeNull();
  });

  it("embeds only an official https PDF and treats blank text as missing", () => {
    expect(viewableOpinionPdf("https://www.supremecourt.gov/opinions/26pdf/26a560_onkq.pdf")).toMatch(/26a560/);
    expect(viewableOpinionPdf("https://www.supremecourt.gov/opinions/26pdf/26a560_onkq.pdf#page=2")).toMatch(/#page=2/);
    expect(viewableOpinionPdf("http://www.supremecourt.gov/opinions/26pdf/x.pdf")).toBeNull();
    expect(viewableOpinionPdf("https://example.com/opinion.pdf")).toBeNull();
    expect(viewableOpinionPdf("javascript:alert(1)")).toBeNull();
    expect(opinionHasExtractedText({ wordCount: 0, contentText: "" })).toBe(false);
    expect(opinionHasExtractedText({ wordCount: 12, contentText: "The Court denies the application." })).toBe(true);
  });
});
