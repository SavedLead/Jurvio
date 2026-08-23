import { describe, expect, it } from "vitest";
import { parseDojUsAttorneys } from "./import-doj-us-attorney-leadership";

describe("DOJ U.S. Attorney leadership parser", () => {
  it("extracts leadership names and appointment state from table rows", () => {
    const html = `<table><tbody>
      <tr><td><a href="/usao-mdal">Alabama, Middle</a></td><td><a href="/usao-mdal">Thomas R. Govan Jr.</a> *</td></tr>
      <tr><td><a href="/usao-mt">Montana</a></td><td><a href="/usao-mt">Mark Smith</a> ^</td></tr>
      <tr><td><a href="/usao-gu">Guam &amp; Northern Mariana Islands</a></td><td>Shawn N. Anderson</td></tr>
    </tbody></table>`;
    expect(parseDojUsAttorneys(html)).toEqual([
      { districtLabel: "Alabama, Middle", displayName: "Thomas R. Govan Jr.", title: "U.S. Attorney" },
      { districtLabel: "Montana", displayName: "Mark Smith", title: "Acting U.S. Attorney" },
      { districtLabel: "Guam & Northern Mariana Islands", displayName: "Shawn N. Anderson", title: "U.S. Attorney" },
    ]);
  });
});
