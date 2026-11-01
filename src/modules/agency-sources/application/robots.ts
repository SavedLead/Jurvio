/**
 * Minimal robots.txt reader: the "User-agent: *" group (or one naming Jurvio),
 * Allow/Disallow with * and $ wildcards (longest match wins), and Crawl-delay.
 */
export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelayMs: number | null }

export function parseRobots(body: string, agentToken = "jurvio"): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [], crawlDelayMs: null } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.rules.allow.push(value);
    if (key === "disallow" && value) current.rules.disallow.push(value);
    if (key === "crawl-delay" && Number.isFinite(Number(value))) current.rules.crawlDelayMs = Math.round(Number(value) * 1000);
  }
  const own = groups.find((group) => group.agents.some((agent) => agent !== "*" && agentToken.includes(agent)));
  const star = groups.filter((group) => group.agents.includes("*"));
  if (own) return own.rules;
  return {
    allow: star.flatMap((group) => group.rules.allow), disallow: star.flatMap((group) => group.rules.disallow),
    crawlDelayMs: star.map((group) => group.rules.crawlDelayMs).find((value) => value !== null) ?? null,
  };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

export function robotsAllows(rules: RobotsRules, url: string): boolean {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  let best: { length: number; allow: boolean } | null = null;
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]] as const) {
    for (const pattern of list) {
      if (!patternMatches(pattern, path)) continue;
      if (!best || pattern.length > best.length || (pattern.length === best.length && allow)) best = { length: pattern.length, allow };
    }
  }
  return best ? best.allow : true;
}
