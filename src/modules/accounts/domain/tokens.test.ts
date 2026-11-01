import { describe, expect, it } from "vitest";
import { generateToken, hashToken, normalizeEmail, safeCasePublicId, safeRedirectPath } from "./tokens";

describe("token and input helpers", () => {
  it("generates long random tokens and hashes them to hex", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("x <a@b.com>")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it("only allows same-site redirect paths", () => {
    expect(safeRedirectPath("/case/jv-1")).toBe("/case/jv-1");
    expect(safeRedirectPath("//evil.example")).toBe("/account");
    expect(safeRedirectPath("https://evil.example")).toBe("/account");
    expect(safeRedirectPath("/\\evil.example")).toBe("/account");
    expect(safeRedirectPath("/api/auth/signout")).toBe("/account");
    expect(safeRedirectPath(undefined)).toBe("/account");
  });

  it("accepts only case-id shaped follow intents", () => {
    expect(safeCasePublicId("jv-abc123")).toBe("jv-abc123");
    expect(safeCasePublicId("../x")).toBeNull();
  });
});
