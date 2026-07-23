import { describe, expect, it } from "vitest";
import { classifyVisitor } from "./classify-visitor";

describe("classifyVisitor", () => {
  it("separates AI retrieval from search crawlers", () => {
    expect(classifyVisitor("Mozilla/5.0 compatible; GPTBot/1.2")).toEqual({
      visitorClass: "ai_bot",
      botFamily: "openai-gptbot",
    });
    expect(classifyVisitor("Mozilla/5.0 Googlebot/2.1")).toEqual({
      visitorClass: "search_bot",
      botFamily: "google",
    });
  });

  it("does not label normal browsers as bots", () => {
    expect(classifyVisitor("Mozilla/5.0 AppleWebKit/537.36 Chrome/126")).toEqual({
      visitorClass: "human",
    });
  });

  it("recognizes machine endpoints and generic API clients without mislabeling known bots", () => {
    expect(classifyVisitor("Mozilla/5.0", { channel: "machine_json" })).toEqual({
      visitorClass: "api",
      botFamily: "unidentified-api-client",
    });
    expect(classifyVisitor("curl/8.7.1")).toEqual({
      visitorClass: "api",
      botFamily: "generic-api-client",
    });
    expect(classifyVisitor("OAI-SearchBot/1.0", { channel: "machine_json" })).toEqual({
      visitorClass: "ai_bot",
      botFamily: "openai-searchbot",
    });
  });

  it("allows authenticated internal traffic to be separated", () => {
    expect(classifyVisitor("Mozilla/5.0", { internal: true })).toEqual({ visitorClass: "internal" });
  });
});
