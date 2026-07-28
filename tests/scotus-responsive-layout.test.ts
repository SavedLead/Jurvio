import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/scotus-layout.css", import.meta.url), "utf8");
const glossaryCss = readFileSync(new URL("../src/modules/legal-context/ui/annotated-legal-text.module.css", import.meta.url), "utf8");

describe("SCOTUS responsive layout contract", () => {
  it("defines the desktop three-column case and reader workspaces", () => {
    expect(css).toMatch(/\.caseWorkspace\s*\{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.opinionWorkspace\s*\{[^}]*grid-template-columns:/s);
  });

  it("stacks content and replaces desktop navigation on phones", () => {
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toMatch(/\.caseWorkspace, \.opinionWorkspace\s*\{\s*display: block/s);
    expect(css).toContain(".caseNavDesktop { display: none !important; }");
    expect(css).toMatch(/\.caseNavMobile\s*\{\s*display: block/s);
  });

  it("keeps controls touch-friendly and opinion content viewport-safe", () => {
    expect(css).toContain("min-height: 46px");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("max-width: 100% !important");
  });

  it("keeps mobile glossary cards inside the dynamic viewport with internal scrolling", () => {
    expect(glossaryCss).toContain("position: fixed");
    expect(glossaryCss).toContain("100dvh");
    expect(glossaryCss).toContain("overflow-y: auto");
    expect(glossaryCss).toContain("env(safe-area-inset-left)");
    expect(glossaryCss).toContain("env(safe-area-inset-right)");
  });
});
