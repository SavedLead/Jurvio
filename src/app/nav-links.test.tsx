import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const pathname = vi.hoisted(() => ({ value: "/pricing" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const { NavLinks, isCurrentSection } = await import("./nav-links");
const { MobileNavigation } = await import("./mobile-navigation");

const items = [["Research", "/search"], ["Cases", "/cases"], ["Judges & Courts", "/judges"], ["Pricing", "/pricing"]] as const;

describe("primary navigation current page", () => {
  it("matches sections and their detail pages", () => {
    expect(isCurrentSection("/pricing", "/pricing")).toBe(true);
    expect(isCurrentSection("/case/jv-1", "/cases")).toBe(true);
    expect(isCurrentSection("/courts/ca9", "/judges")).toBe(true);
    expect(isCurrentSection("/pricing-old", "/pricing")).toBe(false);
    expect(isCurrentSection("/search", "/pricing")).toBe(false);
    expect(isCurrentSection(null, "/pricing")).toBe(false);
  });

  it("marks only the current link with aria-current=page", () => {
    pathname.value = "/pricing";
    const html = renderToStaticMarkup(<NavLinks items={items} />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="page" href="/pricing"');
  });

  it("mobile menu includes Search Jurvio and marks the current page", () => {
    pathname.value = "/cases";
    const html = renderToStaticMarkup(<MobileNavigation items={items} />);
    expect(html).toContain('href="/search">Search Jurvio</a>');
    expect(html).toContain('aria-current="page" href="/cases"');
  });

  it("styles the current page and makes the mobile menu a full-width sheet", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toContain('.desktopNavigation a[aria-current="page"]');
    expect(css).toContain('.mobileNavigation nav a[aria-current="page"]');
    expect(css).toMatch(/\.mobileNavigation nav \{[^}]*left: 0; right: 0;[^}]*background: var\(--surface\)/);
    expect(css).toMatch(/html \{ scroll-padding-top: \d+px; \}/);
  });
});
