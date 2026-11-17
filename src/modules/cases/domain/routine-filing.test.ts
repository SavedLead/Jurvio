import { describe, expect, it } from "vitest";
import { isRoutineFiling } from "./routine-filing";

describe("routine filings", () => {
  it("skips scheduling and service lines", () => {
    expect(isRoutineFiling("Clerk's notice of hearing")).toBe(true);
    expect(isRoutineFiling("Motion for extension of time to file a brief")).toBe(true);
    expect(isRoutineFiling("Certificate of service")).toBe(true);
  });

  it("keeps a merits filing", () => {
    expect(isRoutineFiling("Opinion of the court affirming the judgment")).toBe(false);
    expect(isRoutineFiling("Appellant's opening brief")).toBe(false);
  });
});
