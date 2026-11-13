import { afterEach, describe, expect, it } from "vitest";
import { pagesToRefresh, refreshPublishedPages } from "./refresh-public-pages";

describe("published page refresh", () => {
  const previousSite = process.env.SITE_URL;
  afterEach(() => {
    if (previousSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSite;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ZONE_ID;
  });

  it("warms the shared pages and only real case ids", () => {
    process.env.SITE_URL = "https://jurvio.com";
    expect(pagesToRefresh(["jv-abc12345", "not-a-case", "jv-abc12345"])).toEqual([
      "https://jurvio.com/",
      "https://jurvio.com/cases",
      "https://jurvio.com/supreme-court",
      "https://jurvio.com/supreme-court/emergency",
      "https://jurvio.com/feeds/scotus",
      "https://jurvio.com/feeds/scotus/emergency",
      "https://jurvio.com/feeds/scotus/administration",
      "https://jurvio.com/case/jv-abc12345",
    ]);
  });

  it("purges when a token is set, then prefetches, and ignores a failed purge", async () => {
    process.env.SITE_URL = "https://jurvio.com";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    process.env.CLOUDFLARE_ZONE_ID = "zone";
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("purge_cache")) throw new Error("cloudflare down");
      return new Response("ok");
    }) as typeof fetch;
    await refreshPublishedPages({ casePublicIds: [], fetchImpl });
    expect(calls[0]).toBe("https://api.cloudflare.com/client/v4/zones/zone/purge_cache");
    expect(calls).toContain("https://jurvio.com/");
    expect(calls.some((url) => url.includes("/search"))).toBe(false);
  });
});
