import { describe, expect, it } from "vitest";
import { isPlaceholderCaption } from "./similar-cases";

describe("similar cases captions", () => {
  it("skips placeholder captions only", () => {
    expect(isPlaceholderCaption("Case Name in Immigration Case - Unavailable")).toBe(true);
    expect(isPlaceholderCaption("Sealed v. Sealed")).toBe(true);
    expect(isPlaceholderCaption("Carlos Inestroza-Tosta v. Attorney General")).toBe(false);
    expect(isPlaceholderCaption("Johnson v. Guzman Chavez")).toBe(false);
  });
});
