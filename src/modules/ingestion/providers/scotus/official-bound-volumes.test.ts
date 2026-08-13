import { describe, expect, it } from "vitest";
import { officialBoundVolumeMirrorFileName, parseNominativeBoundVolumeText, parseNominativeTableOfCases, parseNominativeTermYear, parseOfficialBoundVolumeIndex, parseOfficialBoundVolumeText } from "./official-bound-volumes";

describe("official U.S. Reports bound-volume ingestion", () => {
  it("uses the canonical Court filename regardless of source URL casing", () => {
    expect(officialBoundVolumeMirrorFileName(560)).toBe("560BV.pdf");
  });

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
      "Cases reported on page 901 et seq. are orders.\nAlpha v. Beta . . . . . . . . 1\nWilliams v. Johnson . . . . . . . . 773",
      "ALPHA v. BETA\nNo. 13-1. Decided June 1, 2014\n1",
      "merits text with a citation count\n1895",
      "OCTOBER TERM, 2013 773\nWILLIAMS v. JOHNSON\nNo. 13-9085. Decided July 1, 2014",
      "ORDERS IN PENDING CASES\n901",
    ].join("\f");
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

describe("nominative-reporter U.S. Reports (volumes 1-90)", () => {
  // Fixture built from the real Volume 49 (8 Howard, January Term 1850) PDF/A:
  // its front-matter "A Table of the Cases Reported" and its "<page> SUPREME COURT."
  // running headers, whose page numbers occupy the same space as the table.
  const volume49 = [
    "REPORTS OF CASES ARGUED AND ADJUDGED IN THE SUPREME COURT OF THE UNITED STATES,\nJANUARY TERM, 1850.\nBy BENJAMIN C. HOWARD,\nVOL. VIII.",
    "A TABLE OF THE CASES REPORTED\nIN THIS VOLUME.\n[The references are to the star (*) pages.]\nPAGE\n"
      + "Barnum, Wilson v. .......                                 . 258\n"
      + "Bennett v. Butterworth       ....... 124\n"
      + "Butterworth, Bennett v. ......                                124\n"
      + "Staats, United States v............................................................... 41\n"
      + "United States v. Staats........................................................... 41\n"
      + "Wilson v. Barnum............................................................. 258\n",
    "A TABLE OF THE CASES CITED IN THIS VOLUME.\n[The references are to the star (*) pages.]\n",
    "41                      SUPREME COURT.\nThe United States v. Staats.\nThe merits of the case begin here.",
    "126                 SUPREME COURT.\nBennett v. Butterworth.\nmerits text continues here.",
    "258                 SUPREME COURT.\nWilson v. Barnum.\nof the Circuit Court differ in opinion on a point of law.",
  ].join("\f");

  it("reads the term year from the front matter", () => {
    expect(parseNominativeTermYear(volume49)).toBe(1850);
  });

  it("takes case identity from the Table of Cases, deduping reversed entries", () => {
    expect(parseNominativeTableOfCases(volume49, 49)).toEqual([
      { caseName: "United States v. Staats", reportPage: 41 },
      { caseName: "Bennett v. Butterworth", reportPage: 124 },
      { caseName: "Wilson v. Barnum", reportPage: 258 },
    ]);
  });

  it("locates each case's first PDF page from the running-header page numbers", () => {
    // Physically plausible layout (report page <= physical page): three cases at
    // star pages 1, 3, 5. The middle case's header drifts one ahead of its table
    // page (4 vs 3), as it does in the real reprints; the mapping still lands it.
    const compact = [
      "THE SUPREME COURT OF THE UNITED STATES,\nJANUARY TERM, 1850.\nVOL. VIII.",
      "A TABLE OF THE CASES REPORTED\nIN THIS VOLUME.\nPAGE\n"
        + "Barnum, Wilson v. ....... 5\n"
        + "Bennett v. Butterworth ....... 3\n"
        + "Butterworth, Bennett v. ....... 3\n"
        + "Staats, United States v. ....... 1\n"
        + "United States v. Staats ....... 1\n"
        + "Wilson v. Barnum ....... 5\n",
      "A TABLE OF THE CASES CITED IN THIS VOLUME.\n",
      "1                      SUPREME COURT.\nThe United States v. Staats.\nmerits begin here.",
      "4                 SUPREME COURT.\nBennett v. Butterworth.\nmerits text continues here.",
      "5                 SUPREME COURT.\nWilson v. Barnum.\na point of law.",
    ].join("\f");
    const records = parseNominativeBoundVolumeText(compact, {
      volume: 49, termYear: "50",
      pdfUrl: "https://www.supremecourt.gov/pdfs/USReports/USREPORTS-49_PDFA.pdf",
    });
    expect(records).toEqual([
      expect.objectContaining({ caseName: "United States v. Staats", citation: "49 U.S. 1",
        docketNumber: "49US1", filedOn: "1850-01-01", startPage: 4, endPage: 4,
        pdfUrl: "https://www.supremecourt.gov/pdfs/USReports/USREPORTS-49_PDFA.pdf#page=4" }),
      expect.objectContaining({ caseName: "Bennett v. Butterworth", citation: "49 U.S. 3", startPage: 5, endPage: 5 }),
      expect.objectContaining({ caseName: "Wilson v. Barnum", citation: "49 U.S. 5", startPage: 6, endPage: null }),
    ]);
  });
});
