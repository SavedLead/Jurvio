export type VisitorClass = "human" | "search_bot" | "ai_bot" | "agent" | "api" | "internal" | "unknown";

export interface VisitorClassification {
  visitorClass: VisitorClass;
  botFamily?: string;
}

export interface VisitorContext {
  channel?: "html" | "machine_json" | "api";
  internal?: boolean;
  /** Request headers, when available: browser fingerprint headers and Cloudflare bot signals. */
  headers?: Pick<Headers, "get"> | null;
}

/** Crawlers, SEO tools, preview fetchers and automation that carry no "bot" word or hide behind browser UAs. */
const OTHER_AGENTS: Array<[RegExp, string]> = [
  [/HeadlessChrome|Headless|PhantomJS|Puppeteer|Playwright|Selenium|webdriver/i, "headless-browser"],
  [/Lighthouse|PageSpeed|GTmetrix|Chrome-Lighthouse/i, "performance-tool"],
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|DataForSeoBot|Barkrowler|BLEXBot|SeznamBot|serpstatbot|MegaIndex|ZoominfoBot|ImagesiftBot|Screaming Frog|SiteAuditBot|Sogou|Qwantify|Mojeek|coccoc|ia_archiver|archive\.org_bot/i, "seo-crawler"],
  [/facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp|Pinterest|redditbot|Embedly|Iframely|SkypeUriPreview|vkShare|Mastodon/i, "link-preview"],
  [/Go-http-client|Java\/|Apache-HttpClient|libwww|lwp-|node-fetch|undici|got \(|Ruby|Scrapy|aiohttp|httpx|Dart\/|reqwest|colly|Nutch|Heritrix|HTTrack/i, "http-library"],
  [/UptimeRobot|Pingdom|StatusCake|Site24x7|Better ?Uptime|monitor/i, "uptime-monitor"],
];

/**
 * Real browsers on an HTML navigation send Accept-Language, and Chromium also
 * sends Sec-Fetch-Mode and Sec-CH-UA. A UA claiming to be Chrome without them is
 * a script. Cloudflare's verified-bot signal (forwarded by a transform rule as
 * cf-verified-bot / x-verified-bot) wins when present.
 */
function headerVerdict(userAgent: string, headers: Pick<Headers, "get">): VisitorClassification | null {
  const verified = (headers.get("cf-verified-bot") ?? headers.get("x-verified-bot") ?? "").toLowerCase();
  if (verified === "true" || verified === "1") return { visitorClass: "search_bot", botFamily: "cloudflare-verified-bot" };
  const score = Number(headers.get("cf-bot-score") ?? headers.get("x-bot-score") ?? NaN);
  if (Number.isFinite(score) && score > 0 && score < 30) return { visitorClass: "agent", botFamily: "cloudflare-bot-score" };
  if (!headers.get("accept-language")) return { visitorClass: "agent", botFamily: "no-accept-language" };
  const claimsChromium = /Chrome\/\d|Edg\/|OPR\//.test(userAgent);
  if (claimsChromium && !headers.get("sec-fetch-mode") && !headers.get("sec-ch-ua")) {
    return { visitorClass: "agent", botFamily: "chrome-ua-without-client-hints" };
  }
  return null;
}

const AI_BOTS: Array<[RegExp, string]> = [
  [/GPTBot/i, "openai-gptbot"],
  [/ChatGPT-User/i, "openai-chatgpt-user"],
  [/OAI-SearchBot/i, "openai-searchbot"],
  [/ClaudeBot|Claude-User/i, "anthropic-claude"],
  [/PerplexityBot|Perplexity-User/i, "perplexity"],
  [/Google-Extended/i, "google-extended"],
  [/Bytespider/i, "bytespider"],
  [/CCBot/i, "common-crawl"],
  [/Amazonbot/i, "amazonbot"],
  [/cohere-ai|CohereBot/i, "cohere"],
  [/Meta-ExternalAgent|FacebookBot/i, "meta"],
  [/YouBot/i, "you-com"],
  [/Diffbot/i, "diffbot"],
];

const SEARCH_BOTS: Array<[RegExp, string]> = [
  [/Googlebot/i, "google"],
  [/bingbot/i, "bing"],
  [/DuckDuckBot/i, "duckduckgo"],
  [/Applebot/i, "apple"],
  [/YandexBot/i, "yandex"],
  [/Baiduspider/i, "baidu"],
  [/Slurp/i, "yahoo"],
];

export function classifyVisitor(
  userAgent: string | null,
  context: VisitorContext = {},
): VisitorClassification {
  if (context.internal) return { visitorClass: "internal" };
  if (!userAgent) {
    return context.channel === "api" || context.channel === "machine_json"
      ? { visitorClass: "api", botFamily: "unidentified-api-client" }
      : { visitorClass: "unknown" };
  }
  for (const [pattern, family] of AI_BOTS) {
    if (pattern.test(userAgent)) return { visitorClass: "ai_bot", botFamily: family };
  }
  for (const [pattern, family] of SEARCH_BOTS) {
    if (pattern.test(userAgent)) return { visitorClass: "search_bot", botFamily: family };
  }
  if (context.channel === "api" || context.channel === "machine_json") {
    return { visitorClass: "api", botFamily: "unidentified-api-client" };
  }
  if (/bot|crawler|spider|agent/i.test(userAgent)) {
    return { visitorClass: "agent", botFamily: "unclassified-agent" };
  }
  if (/curl|wget|httpie|python-requests|axios|okhttp|postmanruntime/i.test(userAgent)) {
    return { visitorClass: "api", botFamily: "generic-api-client" };
  }
  for (const [pattern, family] of OTHER_AGENTS) {
    if (pattern.test(userAgent)) return { visitorClass: "agent", botFamily: family };
  }
  if (!/Mozilla\/5\.0/.test(userAgent)) return { visitorClass: "agent", botFamily: "non-browser-ua" };
  if (context.headers) {
    const verdict = headerVerdict(userAgent, context.headers);
    if (verdict) return verdict;
  }
  return { visitorClass: "human" };
}
