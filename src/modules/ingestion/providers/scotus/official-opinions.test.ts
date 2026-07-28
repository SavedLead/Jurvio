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
      startPage: null, endPage: null,
    }]);
  });

  it("derives case page ranges from official preliminary-print anchors", () => {
    const preliminaryPrint = `<table>
      <tr><td>63</td><td>7/14/20</td><td>20A8</td><td><a href="/opinions/preliminaryprint/591US2PP_web.pdf#page=538">Barr v. Lee</a></td><td>PC</td><td>591 U.S. 979</td></tr>
      <tr><td>62</td><td>7/09/20</td><td>17-1107</td><td><a href="/opinions/preliminaryprint/591US2PP_web.pdf#page=536">Sharp v. Murphy</a></td><td>PC</td><td>591 U.S. 977</td></tr>
    </table>`;
    const records = parseOfficialSlipOpinionIndex(
      preliminaryPrint,
      "19",
      "https://www.supremecourt.gov/opinions/slipopinion/19",
    );
    expect(records).toEqual([
      expect.objectContaining({
        docketNumber: "17-1107",
        startPage: 536,
        endPage: 537,
        pdfUrl: "https://www.supremecourt.gov/opinions/preliminaryprint/591US2PP_web.pdf#page=536",
      }),
      expect.objectContaining({
        docketNumber: "20A8",
        startPage: 538,
        endPage: null,
      }),
    ]);
  });

  it("rejects non-official PDF links", () => {
    expect(() => parseOfficialSlipOpinionIndex(page.replace("/opinions/24pdf/24-809_8m58.pdf", "https://example.com/a.pdf"), "24", "https://www.supremecourt.gov/opinions/slipopinion/24")).toThrow(/official/);
  });
});
