import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agreeWithOffice, parseDojPage, usaoDistrict } from "./doj";
import { parseFtcCase, parseFtcListing } from "./ftc";
import { parseSecLitigationRelease, parseSecRss, secAdministrativeItem, secUserAgent } from "./sec";
import { extractCaseReferences } from "../domain/extract";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
const now = new Date("2026-10-31T12:00:00Z");

describe("DOJ press releases", () => {
  const { items } = parseDojPage(JSON.parse(fixture("doj-press-releases.json")), now);
  const byPath = (part: string) => items.find((item) => item.sourceUrl.includes(part))!;

  it("reads the issuing office, date, documents and stated dockets", () => {
    expect(items.length).toBe(5);
    const wdla = byPath("usao-wdla");
    expect(wdla.issuingOffice).toBe("USAO - Louisiana, Western");
    expect(wdla.references.map((ref) => `${ref.courtCode}:${ref.docket.canonical}`)).toEqual(["lawd:1:26-cr-00110", "lawd:1:26-cr-00111", "lawd:1:26-cr-00100"]);
    expect(byPath("usao-sdfl").references.map((ref) => `${ref.courtCode}:${ref.docket.canonical}`)).toEqual(["flsd:26-cr-80031"]);
    const opa = byPath("opa/pr/antitrust");
    expect(opa.issuingOffice).toBe("Office of Public Affairs");
    expect(opa.references.map((ref) => `${ref.courtCode}:${ref.docket.canonical}`)).toEqual(["pawd:3:26-cv-01979", "njd:3:26-cv-13625"]);
    expect(byPath("usao-ndil").documents[0]).toMatchObject({ url: expect.stringMatching(/^https:\/\/www\.justice\.gov\/usao-ndil\/media\/\d+\/dl$/) });
    expect(items.every((item) => item.sourceUrl.startsWith("https://www.justice.gov/") && item.publishedAt)).toBe(true);
  });

  it("maps USAO components to their district and distrusts a court from another district", () => {
    expect(usaoDistrict("USAO - Florida, Northern")).toBe("flnd");
    expect(usaoDistrict("USAO - Maine")).toBe("med");
    expect(usaoDistrict("USAO - District of Columbia")).toBe("dcd");
    expect(usaoDistrict("Office of Public Affairs")).toBeNull();
    const refs = extractCaseReferences("charged in the District of Maryland, No. 1:26-cr-00001", now);
    expect(agreeWithOffice(refs, "USAO - Virginia, Eastern")[0]!.courtCode).toBeNull();
    expect(agreeWithOffice(refs, "USAO - Maryland")[0]!.courtCode).toBe("mdd");
  });
});

describe("SEC", () => {
  it("parses litigation releases and the release page's court case", () => {
    const entries = parseSecRss(fixture("sec-litigation-releases.rss.xml"));
    expect(entries.length).toBe(25);
    expect(entries[0]).toMatchObject({ releaseNumber: "LR-26681", url: "https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26681" });
    const item = parseSecLitigationRelease(fixture("sec-lr-26681.html"), entries[0]!, now);
    expect(item.references.map((ref) => [ref.courtCode, ref.docket.canonical, ref.courtEvidence])).toEqual([["scd", "6:26-cv-05267", "(D.S.C. filed Oct. 29, 2026)"]]);
    expect(item.documents).toEqual([{ url: "https://www.sec.gov/files/litigation/complaints/2026/comp26681.pdf", label: "SEC Complaint", kind: "complaint" }]);
    expect(item.officialExcerpt).toMatch(/^Securities and Exchange Commission v\. Cary Edward Urich/);
  });

  it("stores administrative proceedings as not-court items", () => {
    const [entry] = parseSecRss(fixture("sec-administrative-proceedings.rss.xml"));
    expect(secAdministrativeItem(entry!)).toMatchObject({ sourceRecordId: "IA-7033", notCourt: true, references: [] });
  });

  it("always declares a contact e-mail in the User-Agent", () => {
    expect(secUserAgent("Jurvio bot")).toMatch(/@jurvio\.com/);
    expect(secUserAgent("Jurvio ops ops@jurvio.com")).toBe("Jurvio ops ops@jurvio.com");
  });
});

describe("FTC", () => {
  it("reads case cards with action type and last update", () => {
    const entries = parseFtcListing(fixture("ftc-cases-listing.html"));
    expect(entries.length).toBe(6);
    expect(entries.find((entry) => entry.path.endsWith("252-3101-toast-inc"))).toMatchObject({ actionType: "Federal", lastUpdated: "2026-10-29T12:00:00Z" });
    expect(entries.find((entry) => entry.path.endsWith("ricardo-murillo-matter"))?.actionType).toBe("Administrative");
  });

  it("takes court and docket from the case page's own fields", () => {
    const path = "/legal-library/browse/cases-proceedings/252-3163-digital-forensics-corporation-llc-et-al-ftc-v";
    const item = parseFtcCase(fixture("ftc-case-digital-forensics.html"), { path, url: `https://www.ftc.gov${path}`, title: "Digital Forensics", actionType: "Federal", lastUpdated: "2026-10-09T12:00:00Z" }, now);
    expect(item.title).toBe("Digital Forensics Corporation, LLC, et al., FTC v.");
    expect(item.references.map((ref) => [ref.courtCode, ref.docket.canonical])).toEqual([["ohnd", "1:26-cv-02615"]]);
    expect(item.documents.map((document) => document.kind)).toEqual(["complaint", "motion"]);
    expect(item.issuingOffice).toBe("FTC Matter 252 3163");
  });
});
