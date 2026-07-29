import { describe, expect, it } from "vitest";
import { extractOfficialOpinionMetadata } from "./official-opinion-metadata";

describe("official Supreme Court opinion metadata", () => {
  it("extracts per-curiam syllabus, holding, significance, and disposition without inventing an author", () => {
    const result = extractOfficialOpinionMetadata(`Syllabus\nThe State charged Pitts and a jury convicted him. The state supreme court affirmed.\nHeld: The Sixth Amendment tolerates screening only after a case-specific finding of necessity. The state court did not make that finding.\nPp. 1-6.\nCertiorari granted; 405 So. 3d 1238, reversed and remanded.\nPer Curiam\nSUPREME COURT OF THE UNITED STATES`);
    expect(result.perCuriam).toBe(true);
    expect(result.background).toContain("jury convicted");
    expect(result.exactHolding).toContain("case-specific finding");
    expect(result.significance).toBe("The Sixth Amendment tolerates screening only after a case-specific finding of necessity.");
    expect(result.exactDisposition).toContain("reversed and remanded");
    expect(result.lineup.author).toBeNull();
  });

  it("extracts only expressly stated author, joins, and separate writings", () => {
    const result = extractOfficialOpinionMetadata(`JUSTICE KAGAN delivered the opinion of the Court, in which JUSTICE SOTOMAYOR and JUSTICE JACKSON joined.\nJUSTICE GORSUCH, dissenting.`);
    expect(result.lineup.author).toBe("KAGAN");
    expect(result.lineup.joins).toEqual(["SOTOMAYOR", "JACKSON"]);
    expect(result.lineup.separateOpinions).toEqual([{ author: "GORSUCH", type: "dissent", joins: [] }]);
  });
  it("extracts the final vote and every expressly identified justice", () => {
    const result = extractOfficialOpinionMetadata(`KAGAN, J., delivered the opinion of the Court, in which ROBERTS, C. J., and SOTOMAYOR, KAVANAUGH, BARRETT, and JACKSON, JJ., joined.
GORSUCH, J., filed an opinion concurring in the judgment.
THOMAS, J., filed a dissenting opinion, in which ALITO, J., joined.`);
    expect(result.lineup.voteBreakdown.label).toBe("7–2");
    expect(result.lineup.justiceVotes).toEqual(expect.arrayContaining([
      { justice: "KAGAN", position: "court_opinion" },
      { justice: "GORSUCH", position: "concurrence_in_judgment" },
      { justice: "THOMAS", position: "dissent" },
      { justice: "ALITO", position: "dissent" },
    ]));
    expect(result.lineup.justiceVotes).toHaveLength(9);
  });
});
