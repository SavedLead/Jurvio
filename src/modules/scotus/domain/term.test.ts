import { describe, expect, it } from "vitest";
import { scotusTermLabel } from "./term";

describe("scotusTermLabel", () => {
  it("uses the October term boundary", () => {
    expect(scotusTermLabel("2026-06-18")).toBe("2025 Term");
    expect(scotusTermLabel("2026-10-05")).toBe("2026 Term");
  });

  it("does not invent a term for missing or malformed dates", () => {
    expect(scotusTermLabel(null)).toBeNull();
    expect(scotusTermLabel("unknown")).toBeNull();
    expect(scotusTermLabel("2026-13-01")).toBeNull();
  });
});
