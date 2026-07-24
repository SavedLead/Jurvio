import { describe, expect, it } from "vitest";
import { parseOfficialSlipOpinionIndex } from "./official-opinions";

const page = `<table><tr><th>R-</th></tr><tr>
<td>67</td><td>6/27/25</td><td>24-809</td>
<td><a href="/opinions/24pdf/24-809_8m58.pdf">Goldey v. Fields</a></td><td>PC</td><td>606 U.S. 942</td>
</tr></table>`;

describe("official Supreme Court slip-opinion parser", () => {
  it("normalizes a bounded official opinion row", () => {
    expect(parseOfficialSlipOpinionIndex(page, "24", "https://www.supremecourt.gov/opinions/slipopinion/24")).toEqual([{
      sourceRecordId: "24:24-809:24-809_8m58.pdf", releaseNumber: "67", filedOn: "2025-06-27",
      docketNumber: "24-809", caseName: "Goldey v. Fields", authorCode: "PC",
      citation: "606 U.S. 942", pdfUrl: "https://www.supremecourt.gov/opinions/24pdf/24-809_8m58.pdf",
    }]);
  });
  it("rejects non-official PDF links", () => {
    expect(() => parseOfficialSlipOpinionIndex(page.replace("/opinions/24pdf/24-809_8m58.pdf", "https://example.com/a.pdf"), "24", "https://www.supremecourt.gov/opinions/slipopinion/24")).toThrow(/official/);
  });
});
