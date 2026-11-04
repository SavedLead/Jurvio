import { describe, expect, it } from "vitest";
import { classifyEvent, officialDocketSlug, parseOfficialDocket } from "./official-docket";

const sourceUri = "https://www.supremecourt.gov/docket/docketfiles/html/public/24-1159.html";
const fixture = `
<div>Docketed: May 13, 2025</div>
<div>Lower Ct: Supreme Court of Mississippi</div>
<div>Case Numbers: (2021-CT-00740-SCT)</div>
<div>Decision Date: March 20, 2025</div>
<table>
<tr><td>May 09 2025</td><td>Petition for a writ of certiorari filed. <a href="/DocketPDF/24/24-1159/1.pdf">Petition</a> <a href="/DocketPDF/24/24-1159/2.pdf">Appendix</a></td></tr>
<tr><td>Nov 24 2025</td><td>Petition GRANTED. Judgment REVERSED and case REMANDED for further proceedings not inconsistent with the opinion of the Court. Opinion per curiam. <a href="/opinions/25pdf/24-1159_k536.pdf">Detached Opinion</a></td></tr>
</table>`;

describe("official Supreme Court docket parser", () => {
  it("preserves verified dates, events, links, and per-curiam wording", () => {
    const result = parseOfficialDocket(fixture, "24-1159", sourceUri);
    expect(result.docketedOn).toBe("2025-05-13");
    expect(result.lowerCourtName).toBe("Supreme Court of Mississippi");
    expect(result.lowerCourtCaseNumbers).toEqual(["2021-CT-00740-SCT"]);
    expect(result.lowerCourtDecidedOn).toBe("2025-03-20");
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.eventType).toBe("petition_filed");
    expect(result.events[0]?.documents.map((document) => document.documentType)).toEqual(["petition", "petition_appendix"]);
    expect(result.events[1]).toMatchObject({ eventType: "decision", filedOn: "2025-11-24" });
    expect(result.events[1]?.description).toContain("Opinion per curiam");
    expect(result.events[1]?.documents[0]?.url).toBe("https://www.supremecourt.gov/opinions/25pdf/24-1159_k536.pdf");
  });

  it("resolves original-jurisdiction and linked application docket labels", () => {
    expect(officialDocketSlug("141, Orig.")).toBe("22o141");
    expect(officialDocketSlug("21-588 (21A85)")).toBe("21-588");
  });

  it("rejects links outside the official Court origin", () => {
    expect(() => parseOfficialDocket(`<table><tr><td>May 09 2025</td><td>Filed <a href="https://example.com/x.pdf">Main Document</a></td></tr></table>`, "24-1159", sourceUri)).toThrow(/not an official/);
  });
});

describe("application line types (abbreviations, ordered rulings, partial grants)", () => {
  it.each([
    ["Response to application from respondent Moshe Bain, et al. filed.", "application_response_filed"],
    ["Response to application from respondent Acme Holdings, Inc. filed.", "application_response_filed"],
    ["Order entered by Justice Sotomayor: Upon consideration of the application of counsel for the applicants and the response filed thereto, it is ordered that the application for stay is denied without prejudice to applicants again seeking relief.", "application_denied"],
    ["Order entered by Justice Alito: Upon consideration of the application, it is ordered that the application is granted.", "application_granted"],
    ["The application to vacate the Ninth Circuit's stay presented to Justice Kagan and by her referred to the Court is granted as to the parents but is otherwise denied. Opinion per curiam.", "application_granted_in_part"],
    ["Application (26A1) granted in part and denied in part by Justice Kagan.", "application_granted_in_part"],
    ["The application for stay presented to Justice Alito and by him referred to the Court is denied.", "application_denied"],
    ["Application (26A624) referred to the Court.", "application_referred"],
    ["Application (26A1) for a stay, submitted to Justice Kagan.", "application_submitted"],
    ["Response to application (26A458) requested by Justice Kagan, due by 4 p.m. (EDT) on October 13, 2026.", "response_requested"],
    ["Order entered by Justice Alito: Upon consideration of the application, it is ordered that the mandate is stayed pending further order of the undersigned.", "administrative_stay"],
    ["Petition for a writ of certiorari filed. (Response due December 1, 2026)", "petition_filed"],
  ])("%s", (line, type) => {
    expect(classifyEvent(line)).toBe(type);
  });
});
