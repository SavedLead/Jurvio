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
