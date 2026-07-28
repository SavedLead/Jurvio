import { describe, expect, it } from "vitest";
import { extractQuestionPresented } from "./official-filing";

describe("official Supreme Court petition metadata", () => {
  it("extracts a source-bounded question presented", () => {
    expect(extractQuestionPresented(`QUESTION PRESENTED\nWhether a court may deny face-to-face confrontation without evidence and a case-specific finding of necessity.\nOPINIONS BELOW\nThe opinion is reported.`)).toBe("Whether a court may deny face-to-face confrontation without evidence and a case-specific finding of necessity.");
  });
  it("does not invent a question when the verified section is absent", () => {
    expect(extractQuestionPresented("Petition for a writ of certiorari")).toBeNull();
  });
});
