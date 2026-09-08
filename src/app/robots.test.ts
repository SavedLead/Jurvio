import { afterEach, describe, expect, it } from "vitest";
import robots from "./robots";

// Regression guard for the pre-launch indexing lockdown.
//
// /robots.txt was previously served by TWO files that both resolve to the same
// path: this metadata route and a hand-written `app/robots.txt/route.ts` that
// returned a hardcoded "Allow: /" plus a sitemap reference, ignoring
// JURVIO_PUBLIC_LAUNCH entirely. Whichever one Next.js resolved, the site could
// advertise itself as crawlable while every other surface was locked down.
// The route handler is gone; these tests keep the single remaining source of
// truth honest in both directions.
const original = process.env.JURVIO_PUBLIC_LAUNCH;

afterEach(() => {
  if (original === undefined) delete process.env.JURVIO_PUBLIC_LAUNCH;
  else process.env.JURVIO_PUBLIC_LAUNCH = original;
});

describe("robots.txt", () => {
  it("disallows everything and advertises no sitemap before launch", () => {
    delete process.env.JURVIO_PUBLIC_LAUNCH;
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(result.sitemap).toBeUndefined();
  });

  it("stays locked down for any value other than the literal \"true\"", () => {
    for (const value of ["", "false", "TRUE", "1", "yes"]) {
      process.env.JURVIO_PUBLIC_LAUNCH = value;
      const result = robots();
      expect(result.rules, `JURVIO_PUBLIC_LAUNCH=${value}`).toEqual({
        userAgent: "*",
        disallow: "/",
      });
      expect(result.sitemap, `JURVIO_PUBLIC_LAUNCH=${value}`).toBeUndefined();
    }
  });

  it("opens crawling and advertises the sitemap once launched", () => {
    process.env.JURVIO_PUBLIC_LAUNCH = "true";
    const result = robots();
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/internal", "/in", "/preview", "/heartbeat"],
    });
    expect(result.sitemap).toBe("https://jurvio.com/sitemap.xml");
  });
});
