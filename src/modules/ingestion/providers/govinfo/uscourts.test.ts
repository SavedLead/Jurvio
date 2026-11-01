import { describe, expect, it } from "vitest";
import { baseDocketKey, collectionUrl, nextOffsetMark, parseGovInfoPackage } from "./uscourts";

const districts = new Set(["nywd", "mdd", "pamd"]);

describe("GovInfo USCOURTS packages", () => {
  it("reads court and docket from district and circuit package ids", () => {
    expect(parseGovInfoPackage({ packageId: "USCOURTS-nywd-1_17-cv-00937", title: "Rossy v. City of Buffalo et al", dateIssued: "2026-10-30",
      lastModified: "2026-10-31T23:03:34Z" }, districts)).toMatchObject({
      courtCode: "nywd", courtType: "district", docketNumber: "1:17-cv-00937", dateIssued: "2026-10-30",
      detailsUrl: "https://www.govinfo.gov/app/details/USCOURTS-nywd-1_17-cv-00937" });
    expect(parseGovInfoPackage({ packageId: "USCOURTS-caDC-24-5231", dateIssued: "2026-10-23" }, districts))
      .toMatchObject({ courtCode: "cadc", courtType: "appellate", docketNumber: "24-5231" });
    expect(parseGovInfoPackage({ packageId: "USCOURTS-ca13-26-2253", dateIssued: "2026-10-29" }, districts)?.courtCode).toBe("cafc");
  });

  it("skips bankruptcy and other courts, and packages without a date", () => {
    expect(parseGovInfoPackage({ packageId: "USCOURTS-ohsb-2_25-ap-01234", dateIssued: "2026-10-30" }, districts)).toBeNull();
    expect(parseGovInfoPackage({ packageId: "USCOURTS-cit-1_26-00012", dateIssued: "2026-10-30" }, districts)).toBeNull();
    expect(parseGovInfoPackage({ packageId: "USCOURTS-mdd-1_26-cv-04297", dateIssued: null }, districts)).toBeNull();
  });

  it("builds collection URLs and follows nextPage", () => {
    expect(collectionUrl("2026-10-29T00:00:00.000Z", null, 1000))
      .toBe("https://api.govinfo.gov/collections/USCOURTS/2026-10-29T00:00:00Z?offsetMark=*&pageSize=1000");
    expect(nextOffsetMark({ nextPage: "https://api.govinfo.gov/collections/USCOURTS/2026-10-29T00:00:00Z?offsetMark=AoJ4%3D%3D&pageSize=100" })).toBe("AoJ4==");
    expect(nextOffsetMark({ nextPage: null })).toBeNull();
  });

  it("compares district dockets without judge suffixes but keeps the case type", () => {
    expect(baseDocketKey("1:25-cr-00211-NRM")).toBe(baseDocketKey("1:25-cr-00211"));
    expect(baseDocketKey("1:25-cr-03601")).not.toBe(baseDocketKey("1:25-cv-03601"));
  });
});
