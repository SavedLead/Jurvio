import { describe, expect, it } from "vitest";
import { casePagePath, mergeRecentOpinions, opinionPagePath, type PublishedOpinionCard, type SlipOpinionCard } from "./recent-opinions";

const published = (patch: Partial<PublishedOpinionCard> = {}): PublishedOpinionCard => ({
  casePublicId: "jv-nlorv068wz",
  documentPublicId: "jd-igmi9rwamk",
  caseCaption: "Mullin v. Friends of the Ruidosa Church",
  docketNumber: "26A560",
  filedOn: "2026-11-09",
  sourceDownloadUrl: "https://www.supremecourt.gov/opinions/26pdf/26a560_onkq.pdf",
  wordCount: 0,
  opinionType: "Majority opinion",
  perCuriam: false,
  authorName: null,
  precedentialStatus: "Published",
  ...patch,
});

const slip = (patch: Partial<SlipOpinionCard> = {}): SlipOpinionCard => ({
  sourceRecordId: "26:26A560:26a560_onkq.pdf",
  filedOn: "2026-11-09",
  docketNumber: "26A560",
  caseName: "Mullin v. Friends of the Ruidosa Church",
  pdfUrl: "https://www.supremecourt.gov/opinions/26pdf/26a560_onkq.pdf",
  casePublicId: "jv-nlorv068wz",
  documentPublicId: "jd-igmi9rwamk",
  ...patch,
});

describe("recent Supreme Court opinion cards", () => {
  it("keeps one card when the slip index and the published opinion share a docket and PDF", () => {
    const cards = mergeRecentOpinions([published()], [slip()]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.casePath).toBe("/case/jv-nlorv068wz");
    expect(cards[0]?.documentPath).toBe("/case/jv-nlorv068wz/documents/jd-igmi9rwamk");
    expect(cards[0]?.pdfUrl).toMatch(/26a560/);
    expect(cards[0]?.termLabel).toBe("2026 Term");
  });

  it("does not collapse two opinions on one docket when the PDFs differ", () => {
    const cards = mergeRecentOpinions(
      [published()],
      [slip({ sourceRecordId: "other", pdfUrl: "https://www.supremecourt.gov/opinions/26pdf/26a560_dissent.pdf", documentPublicId: "jd-otherdoc1" })],
    );
    expect(cards).toHaveLength(2);
  });

  it("never emits an internal path that is not a real case or opinion id", () => {
    expect(casePagePath("not-an-id")).toBeNull();
    expect(opinionPagePath("jv-nlorv068wz", "not-a-document")).toBeNull();
    const cards = mergeRecentOpinions([], [slip({ casePublicId: null, documentPublicId: null })]);
    expect(cards[0]?.casePath).toBeNull();
    expect(cards[0]?.documentPath).toBeNull();
    expect(cards[0]?.pdfUrl).toMatch(/^https:\/\/www\.supremecourt\.gov\//);
  });
});
