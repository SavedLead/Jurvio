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
    expect(OPINION_TEXT_PENDING_HEADING).toBe("The full opinion isn't on Jurvio yet");
    expect(OPINION_TEXT_PENDING_BODY).toMatch(/written opinion/);
    expect(OPINION_TEXT_PENDING_BODY).not.toMatch(/hold|quarantine|draft|pending|verified/i);
  });
});
