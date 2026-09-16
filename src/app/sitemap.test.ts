import { afterEach, describe, expect, it } from "vitest";
import sitemap from "./sitemap";

const original = process.env.JURVIO_PUBLIC_LAUNCH;

afterEach(() => {
  if (original === undefined) delete process.env.JURVIO_PUBLIC_LAUNCH;
  else process.env.JURVIO_PUBLIC_LAUNCH = original;
});

describe("sitemap.xml", () => {
  it("publishes no URLs before launch", () => {
    delete process.env.JURVIO_PUBLIC_LAUNCH;
    expect(sitemap()).toEqual([]);
  });

  it("publishes canonical public entry points after launch", () => {
    process.env.JURVIO_PUBLIC_LAUNCH = "true";
    const result = sitemap();
    expect(result.map((entry) => entry.url)).toContain("https://jurvio.com/");
    expect(result.map((entry) => entry.url)).toContain("https://jurvio.com/cases");
    expect(result.some((entry) => entry.url.includes("/internal"))).toBe(false);
  });
});
