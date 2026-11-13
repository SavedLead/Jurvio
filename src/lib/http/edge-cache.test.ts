import { describe, expect, it } from "vitest";
import { PUBLIC_EDGE_CACHE_CONTROL, publicEdgeCacheControl } from "./edge-cache";

function request(pathname: string, init: { cookie?: string; search?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  return { method: "GET", hosts: new Set(["jurvio.com"]), pathname, searchParams: new URLSearchParams(init.search ?? ""), headers };
}

describe("edge cache and subscriber-only case records", () => {
  it("shares anonymous case pages", () => {
    expect(publicEdgeCacheControl(request("/case/jv-a3xztujrpi"))).toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });

  it("never shares a response to a request carrying a customer session (paid views stay private)", () => {
    expect(publicEdgeCacheControl(request("/case/jv-a3xztujrpi", { cookie: "jurvio_session=abc; jurvio_signed_in=1" }))).toBeNull();
    expect(publicEdgeCacheControl(request("/cases", { cookie: "jurvio_session=abc" }))).toBeNull();
  });

  it("never shares the ?subscriber=1 reload the gate makes for signed-in visitors", () => {
    expect(publicEdgeCacheControl(request("/case/jv-a3xztujrpi", { search: "subscriber=1" }))).toBeNull();
  });

  it("never shares the Pro emergency analytics page, even its anonymous teaser", () => {
    expect(publicEdgeCacheControl(request("/supreme-court/emergency/analytics"))).toBeNull();
    expect(publicEdgeCacheControl(request("/supreme-court/emergency/analytics", { search: "term=2025" }))).toBeNull();
    expect(PUBLIC_EDGE_CACHE_CONTROL).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    expect(publicEdgeCacheControl(request("/supreme-court/emergency"))).toBe(PUBLIC_EDGE_CACHE_CONTROL);
    expect(publicEdgeCacheControl(request("/supreme-court/emergency/25A1"))).toBe(PUBLIC_EDGE_CACHE_CONTROL);
  });
});
