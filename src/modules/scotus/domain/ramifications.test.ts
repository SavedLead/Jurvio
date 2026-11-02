import { describe, expect, it } from "vitest";
import { citingCourtKind, readSyllabusHeld, summarizeReach } from "./ramifications";

const CELOTEX = `CELOTEX CORP. v. CATRETT Syllabus CERTIORARI TO THE UNITED STATES COURT OF APPEALS FOR THE DISTRICT OF COLUMBIA CIRCUIT No. 85-198. Argued April 1, 1986-Decided June 25, 1986 In September 1980, respondent administratrix filed this wrongful-death action. Held: 1. The Court of Appeals' position is inconsistent with the standard for summary judgment set forth in Rule 56(c), which provides that summary judgment is proper "if the pleadings, depositions, answers to interroga- tories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to a judgment as a matter of law." Pp. 322-326. (a) The plain language of Rule 56(c) mandates the entry of summary judgment. Pp. 322-323. 756 F. 2d 181, reversed and remanded. REHNQUIST, J., delivered the opinion of the Court.`;

describe("readSyllabusHeld", () => {
  it("quotes the first Held point without page markers (Celotex)", () => {
    const held = readSyllabusHeld(CELOTEX);
    expect(held?.text).toBe(`The Court of Appeals' position is inconsistent with the standard for summary judgment set forth in Rule 56(c), which provides that summary judgment is proper "if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to a judgment as a matter of law."`);
    expect(held?.truncated).toBe(true);
  });
  it("strips running heads", () => {
    const held = readSyllabusHeld("Held: The statute is valid because Congress acted within OCTOBER TERM, 1985 Syllabus 477 U. S. its commerce power. Pp. 3-9. Affirmed. KAGAN, J., delivered the opinion of the Court.");
    expect(held?.text).toBe("The statute is valid because Congress acted within its commerce power.");
  });
  it("returns null without a syllabus", () => {
    expect(readSyllabusHeld("MR. CHIEF JUSTICE WARREN delivered the opinion of the Court. Held: nothing.")).toBeNull();
    expect(readSyllabusHeld(null)).toBeNull();
  });
});

describe("reach", () => {
  it("summarizes citing courts", () => {
    const reach = summarizeReach([
      { courtPublicId: "a", courtName: "Seventh Circuit", courtKind: "appellate", cases: 4 },
      { courtPublicId: "b", courtName: "N.D. Ill.", courtKind: "district", cases: 9 },
      { courtPublicId: "c", courtName: "Supreme Court", courtKind: "supreme", cases: 2 },
    ], { first: "1990-01-01", last: "2025-01-01", lastFiveYears: 5 }, 2);
    expect(reach.total).toBe(15);
    expect(reach.byKind).toMatchObject({ appellate: 4, district: 9, supreme: 2 });
    expect(reach.topCourts.map((row) => row.courtName)).toEqual(["N.D. Ill.", "Seventh Circuit"]);
  });
  it("classifies courts", () => {
    expect(citingCourtKind("F", "ca7")).toBe("appellate");
    expect(citingCourtKind("FD", "ilnd")).toBe("district");
    expect(citingCourtKind("F", "scotus")).toBe("supreme");
    expect(citingCourtKind("S", "cal")).toBe("state");
  });
});

describe("readSyllabusHeld running heads", () => {
  it("drops the printed page head inside the Held point", () => {
    const head = "Syllabus Held: BIA orders denying deferral are not final orders of removal under the statute. The order was the final determination. 260 RILEY v. BONDI Syllabus An order of removal becomes final at the earlier of two points. RILEY, J., delivered the opinion of the Court.";
    const held = readSyllabusHeld(head);
    expect(held?.text).not.toContain("RILEY v. BONDI Syllabus");
    expect(held?.text).toContain("determination. An order of removal");
  });
});

