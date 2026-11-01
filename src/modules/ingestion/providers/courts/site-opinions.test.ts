import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_OPINION_SOURCES, parseSiteOpinions, siteDocket } from "./site-opinions";

// Saved 2026-10-31 (ded trimmed to its 25 newest dates).
const page = (court: string) => readFileSync(join(__dirname, "../../live-feeds/fixtures/court-site", `${court}-opinions.html`), "utf8");
const parse = (court: string) => parseSiteOpinions(page(court), SITE_OPINION_SOURCES.find((source) => source.courtCode === court)!);

describe("district court website opinion lists", () => {
  it("reads every listed court's saved page", () => {
    const counts = Object.fromEntries(SITE_OPINION_SOURCES.map((source) => [source.courtCode, parse(source.courtCode).length]));
    expect(counts).toEqual({ ded: 110, nhd: 10, pamd: 10, vid: 10, wied: 5, wvsd: 10 });
    for (const source of SITE_OPINION_SOURCES) {
      for (const item of parse(source.courtCode)) {
        expect(item.documentUrl).toMatch(/^https:\/\/www\.[a-z]+\.uscourts\.gov\/.+\.pdf$/i);
        expect(item.docketNumber, item.documentUrl).toBeTruthy();
        expect(item.caption.length).toBeGreaterThan(3);
      }
    }
  });

  it("ded: date from each table caption, bare docket (no case type) never creates a case", () => {
    expect(parse("ded")[0]).toEqual({ courtCode: "ded", docketNumber: "25-00973", docketComplete: false,
      caption: "Cox et al v. Zenni Holdings, LLC et al", issuedOn: "2026-10-30",
      documentUrl: "https://www.ded.uscourts.gov/sites/ded/files/opinions/25-973.pdf", entryNumber: null });
  });

  it("pamd, wvsd and vid give full dockets; vid also gives the ECF entry number", () => {
    expect(parse("pamd")[0]).toMatchObject({ docketNumber: "1:25-cv-01083", docketComplete: true, issuedOn: "2026-10-29",
      caption: "Asher Bronstin et al. v. Happy Cabbage Analytics" });
    expect(parse("wvsd")[0]).toMatchObject({ docketNumber: "2:26-cv-00679", docketComplete: true, issuedOn: "2026-10-29" });
    expect(parse("vid")[0]).toMatchObject({ docketNumber: "1:26-cr-00001", entryNumber: "101", issuedOn: "2026-10-30",
      caption: "United States of America v. Ervin Noel, Jr." });
  });

  it("nhd and wied: docket without office (attach only); nhd date from the text when given", () => {
    expect(parse("nhd")[0]).toMatchObject({ docketNumber: "26-cv-00761", docketComplete: false, issuedOn: "2026-10-22",
      caption: "Julsaint v. Strafford County DOC, et al." });
    expect(parse("nhd")[1]?.issuedOn).toBeNull();
    expect(parse("wied")[0]).toMatchObject({ docketNumber: "26-cv-00316", caption: "Hill v. City of Milwaukee et al", issuedOn: "2026-10-09" });
  });

  it("normalizes docket forms", () => {
    expect(siteDocket("1:25-CV-01083")).toEqual({ docket: "1:25-cv-01083", complete: true });
    expect(siteDocket("15-611, 15-612, 15-615")).toEqual({ docket: "15-00611", complete: false });
    expect(siteDocket("26mc61")).toEqual({ docket: "26-mc-00061", complete: false });
    expect(siteDocket("no docket here")).toBeNull();
  });
});
