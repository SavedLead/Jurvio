import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const header = readFileSync(new URL("../src/modules/cases/ui/case-header.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/case/[caseId]/page.tsx", import.meta.url), "utf8");

describe("SCOTUS decision metadata display contract", () => {
  it("labels filing and decision dates separately", () => {
    expect(header).toContain("<dt>Filed</dt>");
    expect(header).toContain("<dt>Decided</dt>");
    expect(header).not.toContain("Filed or decided");
  });

  it("binds verified decision metadata from the public case contract", () => {
    expect(page).toContain("decidedOn={legalCase.decidedOn}");
    expect(page).toContain("supremeCourtTerm={legalCase.supremeCourtTerm}");
    expect(page).toContain("officialCitation={legalCase.officialCitation}");
  });

  it("does not substitute the filing date for a known decision date in structured data", () => {
    expect(page).toContain("legalCase.decidedOn ?? legalCase.filedOn");
  });
});
