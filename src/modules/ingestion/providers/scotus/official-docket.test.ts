import { describe, expect, it } from "vitest";
import { officialDocketSlug, parseOfficialDocket } from "./official-docket";

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
