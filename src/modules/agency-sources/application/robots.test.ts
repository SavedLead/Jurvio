import { describe, expect, it } from "vitest";
import { parseRobots, robotsAllows } from "./robots";

describe("robots.txt", () => {
  const rules = parseRobots(`User-agent: *\nCrawl-delay: 5\nDisallow: /search/\nDisallow: /*?combine=\nAllow: /core/*.css$\nDisallow: /core/\n\nUser-agent: BadBot\nDisallow: /\n`);
  it("reads the * group, wildcards and Crawl-delay", () => {
    expect(rules.crawlDelayMs).toBe(5000);
    expect(robotsAllows(rules, "https://www.ftc.gov/legal-library/browse/cases-proceedings")).toBe(true);
    expect(robotsAllows(rules, "https://www.ftc.gov/search/x")).toBe(false);
    expect(robotsAllows(rules, "https://www.ftc.gov/news?combine=x")).toBe(false);
    expect(robotsAllows(rules, "https://www.ftc.gov/core/a.css")).toBe(true);
    expect(robotsAllows(rules, "https://www.ftc.gov/core/a.js")).toBe(false);
  });
  it("prefers a group naming Jurvio", () => {
    const own = parseRobots("User-agent: *\nDisallow:\n\nUser-agent: Jurvio\nDisallow: /private\n");
    expect(robotsAllows(own, "https://x.gov/private/1")).toBe(false);
    expect(robotsAllows(own, "https://x.gov/public")).toBe(true);
  });
});
