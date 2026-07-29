import { describe, expect, it } from "vitest";
import { parseOfficialBoundVolumeIndex, parseOfficialBoundVolumeText } from "./official-bound-volumes";

describe("official U.S. Reports bound-volume ingestion", () => {
  it("discovers authoritative volume links and terms", () => {
    const html = `<li><a id='585' href='boundvolumes/585BV.pdf'>Volume 585&nbsp;&nbsp;(2017 Term - 4983K)</a></li>`;
    expect(parseOfficialBoundVolumeIndex(html)).toEqual([{
      volume: 585,
      termYear: "17",
      pdfUrl: "https://www.supremecourt.gov/opinions/boundvolumes/585BV.pdf",
    }]);
  });

  it("segments merits opinions using physical pages and official reporter pages", () => {
    const text = [
      "TABLE OF CASES REPORTED\nMansky; Minnesota Voters Alliance v. . . . . . . . . 1\nMinnesota Voters Alliance v. Mansky . . . . . . . . 1\nAnimal Science Products v. Hebei Welcome Pharm. Co. . . . . . . . . 33",
      "CASES ADJUDGED\nMINNESOTA VOTERS ALLIANCE v. MANSKY\ncertiorari to the court of appeals\nNo. 16-1435. Argued February 28, 2018—Decided June 14, 2018\n\n1",
      "Cite as: 585 U. S. 1 (2018)\ncontinued text\n3",
      "OCTOBER TERM, 2017                               33\n\nANIMAL SCIENCE PRODUCTS v. HEBEI WELCOME\ncertiorari to the court of appeals\nNo. 16-1220. Argued April 24, 2018—Decided June 14, 2018",
      "continued merits text\n34",
      "ORDERS IN PENDING CASES\nCite as: 585 U. S. 1001 (2018)",
    ].join("\f");
    const records = parseOfficialBoundVolumeText(text, {
      volume: 585, termYear: "17",
      pdfUrl: "https://www.supremecourt.gov/opinions/boundvolumes/585BV.pdf",
    });
    expect(records).toEqual([
      expect.objectContaining({ caseName: "Minnesota Voters Alliance v. Mansky", docketNumber: "16-1435",
        filedOn: "2018-06-14", citation: "585 U.S. 1", startPage: 2, endPage: 3 }),
      expect.objectContaining({ caseName: "Animal Science Products v. Hebei Welcome Pharm. Co.",
        citation: "585 U.S. 33", startPage: 4, endPage: 5 }),
    ]);
  });

  it("uses the volume-specific orders boundary and multi-page case index entries", () => {
    const text = [
      "Cases reported before page 801 are opinions. Cases reported on page 801 et seq. are orders.\nKernan v. Cuero . . . . . . . . 1,1085",
      "KERNAN v. CUERO\nNo. 16-1468. Decided November 6, 2017\n\n1",
      "continued merits text\n9",
      "ORDERS\n801",
    ].join("\f");
    expect(parseOfficialBoundVolumeText(text, { volume: 583, termYear: "17",
      pdfUrl: "https://www.supremecourt.gov/opinions/boundvolumes/583BV.pdf" })).toEqual([
      expect.objectContaining({ caseName: "Kernan v. Cuero", citation: "583 U.S. 1", startPage: 2, endPage: 3 }),
    ]);
  });

  it("ignores incidental high standalone numbers before the explicit orders heading", () => {
    const text = [
      "Cases reported on page 901 et seq. are orders.\\nAlpha v. Beta . . . . . . . . 1\\nWilliams v. Johnson . . . . . . . . 773",
      "ALPHA v. BETA\\nNo. 13-1. Decided June 1, 2014\\n1",
      "merits text with a citation count\\n1895",
      "OCTOBER TERM, 2013 773\\nWILLIAMS v. JOHNSON\\nNo. 13-9085. Decided July 1, 2014",
      "ORDERS IN PENDING CASES\\n901",
    ].join("\\f");
    expect(parseOfficialBoundVolumeText(text, { volume: 573, termYear: "13",
      pdfUrl: "https://www.supremecourt.gov/opinions/boundvolumes/573BV.pdf" })).toEqual([
      expect.objectContaining({ caseName: "Alpha v. Beta", startPage: 2, endPage: 3 }),
      expect.objectContaining({ caseName: "Williams v. Johnson", startPage: 4, endPage: 4 }),
    ]);
  });

  it("does not stage orders beginning at reporter page 1001", () => {
    const text = "A v. B . . . . . . . . 1001\fA v. B\nNo. 17-1. Decided June 14, 2018\n1001";
    expect(parseOfficialBoundVolumeText(text, { volume: 585, termYear: "17",
      pdfUrl: "https://www.supremecourt.gov/opinions/boundvolumes/585BV.pdf" })).toEqual([]);
  });

  it("recovers canonical captions from opinion text and prefers final entered judgments", () => {
    const text = [
      "Texas; United States v. . . . . . . . . 547",
      "OCTOBER TERM, 2015                               547\n\nSyllabus UNITED STATES et al. v. TEXAS et al. certiorari to the court of appeals\nNo. 15-674. Decided June 23, 2016",
      "Montana v. Wyoming . . . . . . . . 600",
      "OCTOBER TERM, 2015                               600\n\nJudgment MONTANA v. WYOMING on bill of complaint\nNo. 137, Orig. Decided May 2, 2011—Order and judgment entered March 21, 2016",
    ].join("\f");
    const records = parseOfficialBoundVolumeText(text, { volume: 579, termYear: "15",
      pdfUrl: "https://www.supremecourt.gov/opinions/boundvolumes/579BV.pdf" });
    expect(records).toEqual([
      expect.objectContaining({ caseName: "United States v. Texas", filedOn: "2016-06-23" }),
      expect.objectContaining({ caseName: "Montana v. Wyoming", filedOn: "2016-03-21" }),
    ]);
  });
});
