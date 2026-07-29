export type RecommendationPriority = "high" | "medium" | "watch";

export interface DemandRecommendation {
  id: string;
  priority: RecommendationPriority;
  title: string;
  rationale: string;
  action: string;
  rule: string;
}

export interface RecommendationSignals {
  totalEvents: number;
  previousEvents: number;
  humanEvents: number;
  searchBotEvents: number;
  aiCrawlerEvents: number;
  agentAndApiEvents: number;
  internalSearches: number;
  zeroResultSearches: number;
  explanationRequests: number;
  topCourt?: { label: string; value: number };
  topCaseType?: { label: string; value: number };
  topTopic?: { label: string; value: number };
}

function share(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

/**
 * Recommendations are deterministic review prompts. They never trigger
 * ingestion, enrichment, publication, or product changes automatically.
 */
export function buildDemandRecommendations(
  signals: RecommendationSignals,
): DemandRecommendation[] {
  if (signals.totalEvents === 0) return [];

  const recommendations: DemandRecommendation[] = [];
  const growth = signals.previousEvents > 0
    ? (signals.totalEvents - signals.previousEvents) / signals.previousEvents
    : null;

  if (
    signals.internalSearches >= 20
    && share(signals.zeroResultSearches, signals.internalSearches) >= 0.25
  ) {
    recommendations.push({
      id: "search-coverage-gap",
      priority: "high",
      title: "Review search coverage gaps",
      rationale: `${signals.zeroResultSearches.toLocaleString()} of ${signals.internalSearches.toLocaleString()} searches returned no results.`,
      action: "Review coarse query-shape buckets and corpus gaps before selecting the next ingestion batch.",
      rule: "At least 20 searches and at least 25% with zero results.",
    });
  }

  if (signals.explanationRequests >= 10) {
    recommendations.push({
      id: "explanation-queue",
      priority: signals.explanationRequests >= 50 ? "high" : "medium",
      title: "Review requested explanations",
      rationale: `${signals.explanationRequests.toLocaleString()} explanation requests were recorded in this window.`,
      action: "Prioritize source-backed explainers for repeated requests after editorial review.",
      rule: "At least 10 explanation requests; high priority at 50.",
    });
  }

  if (signals.topCourt && share(signals.topCourt.value, signals.humanEvents) >= 0.2) {
    recommendations.push({
      id: "court-concentration",
      priority: "medium",
      title: `Evaluate deeper ${signals.topCourt.label} coverage`,
      rationale: `${signals.topCourt.value.toLocaleString()} events are associated with this court, at least 20% of human demand.`,
      action: "Compare source availability, freshness, and publication risk before expanding coverage.",
      rule: "Top court events are at least 20% of human events.",
    });
  }

  if (signals.topCaseType && signals.topCaseType.value >= 15) {
    recommendations.push({
      id: "case-type-interest",
      priority: "medium",
      title: `Review ${signals.topCaseType.label} coverage`,
      rationale: `${signals.topCaseType.value.toLocaleString()} events carry this case-type signal.`,
      action: "Assess whether a focused landing page, explainer, or bounded source batch would improve coverage.",
      rule: "Top case type has at least 15 events.",
    });
  }

  if (signals.topTopic && signals.topTopic.value >= 15) {
    recommendations.push({
      id: "topic-interest",
      priority: "medium",
      title: `Review demand for ${signals.topTopic.label}`,
      rationale: `${signals.topTopic.value.toLocaleString()} events carry this topic signal.`,
      action: "Validate the topic classification and source quality before creating or expanding content.",
      rule: "Top topic has at least 15 events.",
    });
  }

  if (
    signals.aiCrawlerEvents + signals.agentAndApiEvents >= 25
    && share(
      signals.aiCrawlerEvents + signals.agentAndApiEvents,
      signals.totalEvents,
    ) >= 0.15
  ) {
    recommendations.push({
      id: "machine-retrieval",
      priority: "watch",
      title: "Inspect machine-readable coverage",
      rationale: `${(signals.aiCrawlerEvents + signals.agentAndApiEvents).toLocaleString()} events came from known retrieval crawlers, agents, or APIs.`,
      action: "Check structured data, canonical links, citations, and machine endpoints on the most-requested entities.",
      rule: "At least 25 machine retrieval events and at least 15% of all events.",
    });
  }

  if (growth !== null && signals.totalEvents >= 50 && growth >= 0.5) {
    recommendations.push({
      id: "demand-growth",
      priority: "watch",
      title: "Investigate the demand increase",
      rationale: `Aggregate events increased ${Math.round(growth * 100)}% compared with the preceding equal-length window.`,
      action: "Confirm the increase is distributed across useful pages and is not dominated by one crawler family.",
      rule: "At least 50 current events and at least 50% period-over-period growth.",
    });
  }

  const rank: Record<RecommendationPriority, number> = {
    high: 0,
    medium: 1,
    watch: 2,
  };
  return recommendations.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
