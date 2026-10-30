import { describe, expect, it } from "vitest";
import {
  OPINION_TEXT_PENDING_BODY,
  OPINION_TEXT_PENDING_HEADING,
  opinionTextIsPending,
} from "./opinion-availability";

describe("opinion text availability", () => {
  it("asks for a pending notice only when no readable opinion is published", () => {
    expect(opinionTextIsPending(false)).toBe(true);
    expect(opinionTextIsPending(true)).toBe(false);
  });

  it("uses public language for the pending state", () => {
    expect(OPINION_TEXT_PENDING_HEADING).toBe("Opinion text is pending");
    expect(OPINION_TEXT_PENDING_BODY).toMatch(/verified case details/);
    expect(OPINION_TEXT_PENDING_BODY).not.toMatch(/hold|quarantine|draft/i);
  });
});
