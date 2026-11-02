import { describe, expect, it } from "vitest";
import { firstSentence, keyDate, summaryFromStanding } from "./case-summary";

describe("case summary card", () => {
  it("cuts at the first real sentence end, not at abbreviations or dates", () => {
    expect(firstSentence("A win for Estate of Jacob Dominguez (the respondent, the side that won in the lower court). The Supreme Court denied certiorari on Feb. 24, 2025, so it stands."))
      .toBe("A win for Estate of Jacob Dominguez (the respondent, the side that won in the lower court).");
    expect(firstSentence("Denied on Feb. 24, 2025 in Miranda v. Arizona by the U.S. Supreme Court.")).toBe("Denied on Feb. 24, 2025 in Miranda v. Arizona by the U.S. Supreme Court.");
    expect(firstSentence("No. The court closed this case on May 22, 2019.")).toBe("No. The court closed this case on May 22, 2019.");
  });

  it("reads who won and what it means from the stands points", () => {
    const summary = summaryFromStanding({ headline: "The court ruled for Toro (the defendant).", points: [
      { id: "status", label: "Is the case still open?", text: "No. The court closed this case on May 22, 2019." },
      { id: "who-won", label: "Who won?", text: "Toro (the defendant). The court entered judgment for the defendant." },
    ] });
    expect(summary).toEqual({ whatHappened: "The court ruled for Toro (the defendant).", whoWon: "Toro (the defendant).", goingForward: "The court closed this case on May 22, 2019.", goingForwardLabel: "Status" });
  });

  it("picks the key date", () => {
    const base = { courtKind: "supreme", decidedOn: null, terminatedOn: null, filedOn: "2024-08-15", fjcClosedOn: null, certStatus: "denied", certStatusOn: "2025-02-24" };
    expect(keyDate(base)).toEqual({ label: "Review denied", date: "2025-02-24" });
    expect(keyDate({ ...base, decidedOn: "2023-06-30" })).toEqual({ label: "Decided", date: "2023-06-30" });
    expect(keyDate({ ...base, courtKind: "district", certStatus: null, certStatusOn: null, fjcClosedOn: "2019-05-22" })).toEqual({ label: "Closed", date: "2019-05-22" });
    expect(keyDate({ ...base, courtKind: "district", certStatus: null, certStatusOn: null })).toEqual({ label: "Filed", date: "2024-08-15" });
  });
});
