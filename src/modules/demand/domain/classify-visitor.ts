export type VisitorClass = "human" | "search_bot" | "ai_bot" | "agent" | "api" | "internal" | "unknown";

export interface VisitorClassification {
  visitorClass: VisitorClass;
  botFamily?: string;
}

export interface VisitorContext {
  channel?: "html" | "machine_json" | "api";
  internal?: boolean;
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
  return { visitorClass: "human" };
}
