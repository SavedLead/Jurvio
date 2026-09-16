import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("global keyboard accessibility", () => {
  it("provides a skip link and matching main-content target", () => {
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('id="main-content"');
  });

  it("shows a strong focus indicator on interactive controls", () => {
    expect(css).toContain("a:focus-visible");
    expect(css).toContain("button:focus-visible");
    expect(css).toContain("input:focus-visible");
    expect(css).toContain("select:focus-visible");
    expect(css).toContain("summary:focus-visible");
  });
});
