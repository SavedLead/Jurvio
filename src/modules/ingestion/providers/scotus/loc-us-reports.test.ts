import { describe, expect, it } from "vitest";
import { parseLocUsReportsResults } from "./loc-us-reports";

describe("Library of Congress U.S. Reports ingestion", () => {
  it("discovers official per-case PDFs newest-to-oldest within a volume", () => {
    const payload = {
      results: [
        {
          id: "https://www.loc.gov/item/usrep501529/",
          title: "James B. Beam Distilling Co. v. Georgia, 501 U.S. 529 (1991)",
          resources: [{ files: [{ url: "https://www.loc.gov/resource/usrep501529/usrep501529.pdf" }] }],
        },
        {
          id: "https://www.loc.gov/item/usrep501001/",
          title: "Payne v. Tennessee, 501 U.S. 808 (1991)",
          resources: [{ url: "https://www.loc.gov/resource/usrep501808/usrep501808.pdf" }],
        },
      ],
    };
    expect(parseLocUsReportsResults(payload, 501)).toEqual([
      expect.objectContaining({
        sourceRecordId: "loc:usrep501529",
        caseName: "James B. Beam Distilling Co. v. Georgia",
        citation: "501 U.S. 529",
        reporterPage: 529,
      }),
      expect.objectContaining({ caseName: "Payne v. Tennessee", reporterPage: 808 }),
    ]);
  });

  it("accepts the Library of Congress U.S. Reports title prefix", () => {
    const payload = {
      results: [{
        id: "https://www.loc.gov/item/usrep501001/",
        title: "U.S. Reports: Connecticut et al. v. Doehr, 501 U.S. 1 (1991).",
        resources: [{ url: "https://www.loc.gov/resource/usrep501001/usrep501001.pdf" }],
      }],
    };
    expect(parseLocUsReportsResults(payload, 501)).toEqual([
      expect.objectContaining({ caseName: "Connecticut et al. v. Doehr", citation: "501 U.S. 1" }),
    ]);
  });

  it("accepts the official United States Reports title prefix", () => {
    const payload = {
      results: [{
        id: "https://www.loc.gov/item/usrep499001/",
        title: "United States Reports: Alabama v. Smith, 499 U.S. 1 (1991).",
        resources: [{ url: "https://www.loc.gov/resource/usrep499001/usrep499001.pdf" }],
      }],
    };
    expect(parseLocUsReportsResults(payload, 499)).toEqual([
      expect.objectContaining({ caseName: "Alabama v. Smith", citation: "499 U.S. 1" }),
    ]);
  });

  it("parses the citation format used by the official historical-volume search", () => {
    const payload = {
      results: [{
        id: "https://www.loc.gov/item/usrep499001/",
        title: "U.S. Reports: Alabama v. Smith, 499 U.S. 1 (1991).",
        resources: [{ url: "https://www.loc.gov/resource/usrep499001/usrep499001.pdf" }],
      }],
    };
    expect(parseLocUsReportsResults(payload, 499)).toEqual([
      expect.objectContaining({ citation: "499 U.S. 1", reporterPage: 1 }),
    ]);
  });

  it("rejects cross-volume, duplicate, and non-PDF records", () => {
    const valid = {
      id: "https://www.loc.gov/item/usrep501529/",
      title: "James B. Beam Distilling Co. v. Georgia, 501 U.S. 529 (1991)",
      resources: [{ url: "https://www.loc.gov/resource/usrep501529/usrep501529.pdf" }],
    };
    expect(parseLocUsReportsResults({
      results: [
        valid,
        valid,
        { ...valid, title: "Other v. Case, 500 U.S. 1 (1991)" },
        { ...valid, resources: [{ url: "https://www.loc.gov/item/usrep501529/" }] },
      ],
    }, 501)).toHaveLength(1);
  });
});