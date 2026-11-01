import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper without types
import { robotsBlocksGoogleSearch } from "../scripts/robots-google-blocked.mjs";

const cloudflareManaged = `# BEGIN Cloudflare Managed content
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: AwarioSmartBot
User-agent: AwarioRssBot
Disallow: /
# END Cloudflare Managed Content
Sitemap: https://jurvio.com/sitemap.xml`;

describe("robotsBlocksGoogleSearch", () => {
  it("ignores AI-crawler groups in Cloudflare's managed robots.txt", () => {
    expect(robotsBlocksGoogleSearch(cloudflareManaged)).toBe(false);
  });
  it("blocks when the * group disallows everything (pre-launch)", () => {
    expect(robotsBlocksGoogleSearch("User-agent: *\nDisallow: /\n")).toBe(true);
  });
  it("prefers a Googlebot group over *", () => {
    expect(robotsBlocksGoogleSearch("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n")).toBe(false);
    expect(robotsBlocksGoogleSearch("User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /\n")).toBe(true);
  });
  it("does not treat partial disallows as a block", () => {
    expect(robotsBlocksGoogleSearch("User-agent: *\nDisallow: /internal/\nDisallow: /api/\n")).toBe(false);
  });
});
