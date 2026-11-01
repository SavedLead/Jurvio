import { describe, expect, it } from "vitest";
import { clientIp, isSameOriginRequest } from "./request";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("request helpers", () => {
  it("blocks cross-site browser posts and allows same-origin or origin-less posts", () => {
    expect(isSameOriginRequest(req({ host: "jurvio.com", origin: "https://jurvio.com" }))).toBe(true);
    expect(isSameOriginRequest(req({ host: "127.0.0.1:3000", "x-forwarded-host": "jurvio.com", origin: "https://jurvio.com" }))).toBe(true);
    expect(isSameOriginRequest(req({ host: "jurvio.com", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(req({ host: "jurvio.com", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({ host: "jurvio.com" }))).toBe(true);
  });

  it("prefers the Cloudflare client IP", () => {
    expect(clientIp(req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
