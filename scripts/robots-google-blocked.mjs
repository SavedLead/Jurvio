// Whether robots.txt blocks Google Search from the whole site.
//
// Only the group that applies to Googlebot counts: a group naming "googlebot",
// otherwise the "*" group (Google's own precedence). Groups for other crawlers
// (for example Cloudflare's managed "Disallow: /" for GPTBot, CCBot, ClaudeBot,
// Google-Extended ...) do not block Google Search and must not stop the sync.
export function robotsBlocksGoogleSearch(robotsText) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(robotsText ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current && (field === "allow" || field === "disallow")) current.rules.push({ field, value });
  }
  const pick = groups.filter((group) => group.agents.includes("googlebot"));
  const applicable = pick.length > 0 ? pick : groups.filter((group) => group.agents.includes("*"));
  const rules = applicable.flatMap((group) => group.rules);
  const disallowAll = rules.some((rule) => rule.field === "disallow" && rule.value === "/");
  const allowAll = rules.some((rule) => rule.field === "allow" && rule.value === "/");
  return disallowAll && !allowAll;
}
