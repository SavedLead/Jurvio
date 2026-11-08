import { describe, expect, it } from "vitest";
import { currentOctoberTerm, scotusTermLabel } from "./term";

describe("scotusTermLabel", () => {
  it("uses the October term boundary", () => {
    expect(scotusTermLabel("2026-06-18")).toBe("2025 Term");
    expect(scotusTermLabel("2026-10-05")).toBe("2026 Term");
  });

  it("points current-term links at the October that has started", () => {
    expect(currentOctoberTerm(new Date("2026-11-08T14:32:00Z"))).toMatchObject({ year: 2026, yy: "26", label: "October Term 2026" });
    expect(currentOctoberTerm(new Date("2026-09-30T12:00:00Z"))).toMatchObject({ year: 2025, yy: "25" });
  });

  it("does not invent a term for missing or malformed dates", () => {
    expect(scotusTermLabel(null)).toBeNull();
    expect(scotusTermLabel("unknown")).toBeNull();
    expect(scotusTermLabel("2026-13-01")).toBeNull();
  });
});
