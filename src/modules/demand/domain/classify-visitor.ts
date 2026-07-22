export type VisitorClass = "human" | "search_bot" | "ai_bot" | "agent" | "api" | "internal" | "unknown";

export interface VisitorClassification {
  visitorClass: VisitorClass;
  botFamily?: string;
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
];

const SEARCH_BOTS: Array<[RegExp, string]> = [
  [/Googlebot/i, "google"],
  [/bingbot/i, "bing"],
  [/DuckDuckBot/i, "duckduckgo"],
  [/Applebot/i, "apple"],
  [/YandexBot/i, "yandex"],
];

export function classifyVisitor(userAgent: string | null): VisitorClassification {
  if (!userAgent) return { visitorClass: "unknown" };
  for (const [pattern, family] of AI_BOTS) {
    if (pattern.test(userAgent)) return { visitorClass: "ai_bot", botFamily: family };
  }
  for (const [pattern, family] of SEARCH_BOTS) {
    if (pattern.test(userAgent)) return { visitorClass: "search_bot", botFamily: family };
  }
  if (/bot|crawler|spider|agent/i.test(userAgent)) {
    return { visitorClass: "agent", botFamily: "unclassified-agent" };
  }
  return { visitorClass: "human" };
}
