import { describe, expect, it } from "vitest";
import { buildDemandRecommendations } from "./recommendations";

const base = {
  totalEvents: 100,
  previousEvents: 80,
  humanEvents: 60,
  searchBotEvents: 20,
  aiCrawlerEvents: 5,
  agentAndApiEvents: 5,
  internalSearches: 10,
  zeroResultSearches: 1,
  explanationRequests: 1,
};

describe("buildDemandRecommendations", () => {
  it("returns no recommendations without observed demand", () => {
    expect(buildDemandRecommendations({ ...base, totalEvents: 0 })).toEqual([]);
  });

  it("flags a material search coverage gap using aggregate thresholds", () => {
    const rows = buildDemandRecommendations({
      ...base,
      internalSearches: 40,
      zeroResultSearches: 12,
    });
    expect(rows[0]).toMatchObject({
      id: "search-coverage-gap",
      priority: "high",
    });
  });

  it("does not flag sparse zero-result activity", () => {
    const rows = buildDemandRecommendations({
      ...base,
      internalSearches: 8,
      zeroResultSearches: 8,
    });
    expect(rows.some((row) => row.id === "search-coverage-gap")).toBe(false);
  });

  it("keeps machine retrieval guidance advisory", () => {
    const rows = buildDemandRecommendations({
      ...base,
      aiCrawlerEvents: 15,
      agentAndApiEvents: 10,
    });
    expect(rows).toContainEqual(expect.objectContaining({
      id: "machine-retrieval",
      priority: "watch",
      action: expect.stringContaining("Check structured data"),
    }));
  });
});
