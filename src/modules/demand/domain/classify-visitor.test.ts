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
});
