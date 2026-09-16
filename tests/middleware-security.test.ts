import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

const originalLaunch = process.env.JURVIO_PUBLIC_LAUNCH;

afterEach(() => {
  if (originalLaunch === undefined) delete process.env.JURVIO_PUBLIC_LAUNCH;
  else process.env.JURVIO_PUBLIC_LAUNCH = originalLaunch;
});

function request(path: string, host = "jurvio.com") {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host, "x-forwarded-host": host },
  });
}

describe("host security boundaries", () => {
  it.each([
    "/login",
    "/change-password",
    "/internal",
    "/internal/analytics",
    "/in",
    "/in/uptime",
    "/heartbeat",
    "/preview/case",
    "/api/internal-auth/login",
  ])("returns 404 for private path %s on the public host", (path) => {
    const response = middleware(request(path));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("allows public pages while retaining pre-launch noindex", () => {
    delete process.env.JURVIO_PUBLIC_LAUNCH;
    const response = middleware(request("/cases"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("does not add the pre-launch header after the launch switch is enabled", () => {
    process.env.JURVIO_PUBLIC_LAUNCH = "true";
    const response = middleware(request("/cases"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });
});
