import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { PUBLIC_EDGE_CACHE_CONTROL, hasAuthCookie } from "../src/lib/http/edge-cache";

function request(path: string, init: { host?: string; method?: string; headers?: Record<string, string> } = {}) {
  const host = init.host ?? "jurvio.com";
  return new NextRequest(`https://${host}${path}`, {
    method: init.method ?? "GET",
    headers: { host, "x-forwarded-host": host, ...init.headers },
  });
}

const cacheControl = (path: string, init?: Parameters<typeof request>[1]) =>
  middleware(request(path, init)).headers.get("cache-control");

describe("edge cache policy for anonymous public pages", () => {
  it.each([
    "/",
    "/case/abc123",
    "/case/abc123/docket",
    "/cases",
    "/cases?court=SDNY",
    "/cases?decided=1&from=2020&page=2",
    "/cases?q=",
    "/judges",
    "/judges?page=3",
    "/judges/jj-l35u3td55d",
    "/courts",
    "/courts/SCOTUS",
    "/parties",
    "/parties/p-1",
    "/law-firms",
    "/law-firms/f-1",
    "/supreme-court",
    "/scotus",
    "/coverage",
    "/privacy",
    "/terms",
    "/methodology",
    "/explainers/standing",
    "/robots.txt",
    "/sitemap.xml",
    "/sitemaps/cases/40",
    "/sitemaps/static.xml",
  ])("marks %s as publicly cacheable", (path) => {
    expect(cacheControl(path)).toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it.each([
    "/cases?q=smith",
    "/cases?party=acme",
    "/cases?firm=jones&court=SDNY",
    "/search",
    "/search?q=habeas",
    "/api/health",
    "/api/ready",
    "/api/operations/appellate",
    "/admin",
    "/caseload",
    "/judgesx",
    "/cases?_rsc=abc",
  ])("leaves %s uncached", (path) => {
    expect(cacheControl(path)).not.toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it.each(["/login", "/change-password", "/internal/freshness", "/heartbeat", "/preview/case", "/api/internal-auth/login"])(
    "keeps private 404 for %s on the public host",
    (path) => {
      expect(cacheControl(path)).toBe("private, no-store");
    },
  );

  it.each([
    "jurvio_admin_session=abcdefghijklmnopqrstuvwxyz0123456789",
    "ph_x=1; CF_Authorization=eyJhbGciOi",
    "__prerender_bypass=1",
  ])("never marks a request carrying an auth cookie (%s) public", (cookie) => {
    expect(cacheControl("/cases", { headers: { cookie } })).not.toBe(PUBLIC_EDGE_CACHE_CONTROL);
    expect(cacheControl("/case/abc", { headers: { cookie } })).not.toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it("ignores unrelated analytics cookies", () => {
    expect(cacheControl("/cases", { headers: { cookie: "ph_phc_key_posthog=%7B%7D" } })).toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it.each<Record<string, string>>([
    { authorization: "Bearer x" },
    { "cf-access-jwt-assertion": "jwt" },
    { rsc: "1" },
    { "next-router-prefetch": "1" },
    { "next-router-state-tree": "%5B%5D" },
    { "next-action": "abc" },
  ])("never marks requests with %o public", (headers) => {
    expect(cacheControl("/cases", { headers })).not.toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it("only applies to GET and HEAD", () => {
    expect(cacheControl("/", { method: "HEAD" })).toBe(PUBLIC_EDGE_CACHE_CONTROL);
    expect(cacheControl("/", { method: "POST" })).not.toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it("never applies to the command-center host", () => {
    expect(cacheControl("/judges", { host: "z.jurvio.com" })).toBe("private, no-store, must-revalidate");
    expect(cacheControl("/", { host: "z.jurvio.com" })).toBe("private, no-store, must-revalidate");
  });

  it("does not apply to unknown hosts", () => {
    expect(cacheControl("/cases", { host: "localhost:3000" })).not.toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it("parses cookie names exactly", () => {
    expect(hasAuthCookie("xjurvio_admin_session=1")).toBe(false);
    expect(hasAuthCookie("a=1; jurvio_admin_session=2")).toBe(true);
    expect(hasAuthCookie(null)).toBe(false);
  });
});
